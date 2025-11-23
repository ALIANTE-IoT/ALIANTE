import base64
import json
import os
from datetime import datetime
from io import BytesIO

import numpy as np
import openai
import requests
import supervision as sv
import torch
from flask import Flask, jsonify, request
from PIL import Image
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Image as RLImage
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sklearn.cluster import AgglomerativeClustering
from transformers import AutoModel, AutoProcessor

SIGLIP_MODEL_NAME = os.environ.get("SIGLIP_MODEL", "google/siglip-so400m-patch14-384")

print(f"Loading SigLIP vision backbone: {SIGLIP_MODEL_NAME}")
siglip_model = AutoModel.from_pretrained(SIGLIP_MODEL_NAME).vision_model
siglip_processor = AutoProcessor.from_pretrained(SIGLIP_MODEL_NAME)
siglip_model.eval()

# Variabile globale per memorizzare il JSON ricevuto
json_data = None

# Inizializza Flask app
app = Flask(__name__)


@app.route("/receive", methods=["POST"])
def receive_json():
    global json_data
    try:
        json_data = request.get_json()
        print(f"JSON ricevuto: {json_data}")
        # Avvia l'elaborazione
        process_data()
        return jsonify(
            {"status": "success", "message": "JSON ricevuto correttamente"}
        ), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


def extract_crop(original_path, mask_path):
    # Load images
    original = original_path.convert("RGB")
    mask = mask_path.convert("RGB")

    # Ensure both images have the same size
    if original.size != mask.size:
        raise ValueError(
            f"Image sizes don't match: original {original.size}, mask {mask.size}"
        )

    # Convert to numpy arrays
    original_array = np.array(original)
    mask_array = np.array(mask)

    # Create binary mask where red pixels are (R > threshold and R > G and R > B)
    red_mask = mask_array[:, :, 0] >= 255

    # Find bounding box of the red mask
    rows = np.any(red_mask, axis=1)
    cols = np.any(red_mask, axis=0)

    if not rows.any() or not cols.any():
        raise ValueError("No red pixels found in mask")

    y_min, y_max = np.where(rows)[0][[0, -1]]
    x_min, x_max = np.where(cols)[0][[0, -1]]

    # Create output image with transparent background
    output_array = np.zeros_like(original_array)
    output_array = np.dstack(
        [output_array, np.zeros(original_array.shape[:2], dtype=np.uint8)]
    )  # Add alpha channel

    # Copy pixels where mask is red
    output_array[red_mask, :3] = original_array[red_mask]
    output_array[red_mask, 3] = 255  # Set alpha to opaque

    # Crop to bounding box
    cropped = output_array[y_min : y_max + 1, x_min : x_max + 1]

    # Convert to PIL Image and save
    output_image = Image.fromarray(cropped, "RGBA")

    return output_image


def print_cluster():
    clusters = {}
    for id in ids:
        clusters[id] = []

    for i, label in enumerate(labels):
        # print(i, label)
        clusters[label].append(crops[i])

    for id in ids:
        sv.plot_images_grid(images=clusters[id], grid_size=(10, 10), size=(12, 12))


def process_data():
    global json_data
    # accesso a dati
    data = json_data
    image = data["content"][0]["text"]
    image_infos = eval(image)

    # url originale immagine
    original_url = image_infos["image"]["url"]

    # url originale immagine
    mask = image_infos["annotations"][0]["image"]["url"]

    original_url = image_infos["image"]["url"]
    original_img = Image.open(BytesIO(requests.get(original_url).content))
    objects = []

    for annotation in image_infos["annotations"]:
        annotation_url = annotation["image"]["url"]
        annotation_img = Image.open(BytesIO(requests.get(annotation_url).content))
        objects.append(annotation_img)

    crops = []
    for obj in objects:
        crops.append(extract_crop(original_img, obj))

    with torch.no_grad():
        inputs = siglip_processor(images=crops, return_tensors="pt")
        embeddings = siglip_model(**inputs).pooler_output.cpu().numpy()

    clustering = AgglomerativeClustering(n_clusters=None, distance_threshold=20)
    labels = clustering.fit_predict(embeddings)

    # Organizza le immagini per cluster
    clusters = {}
    n_clusters = len(set(labels))

    for i, label in enumerate(labels):
        if label not in clusters:
            clusters[label] = []
        clusters[label].append({"image": crops[i], "index": i})

    # Genera il report con ChatGPT
    generate_report(clusters, original_url, image_infos, n_clusters)


def image_to_base64(img):
    """Converti un'immagine PIL in base64"""
    buffered = BytesIO()
    img.save(buffered, format="PNG")
    return base64.b64encode(buffered.getvalue()).decode()


def generate_report(clusters, original_url, image_infos, n_clusters):
    """Genera un report PDF usando ChatGPT per l'analisi"""

    openai_api_key = os.environ.get("OPENAI_API_KEY")
    if not openai_api_key:
        print("Error: OPENAI_API_KEY non impostata")
        return

    openai.api_key = openai_api_key

    # Prepara le immagini per ogni cluster (sample)
    cluster_samples = {}
    for cluster_id, items in clusters.items():
        # Prendi al massimo 3 immagini per cluster per non superare i limiti
        samples = items[:3]
        cluster_samples[cluster_id] = [
            image_to_base64(item["image"]) for item in samples
        ]

    # Costruisci il prompt per ChatGPT
    prompt = f"""Analyze these clustered images from a drone survey.

Total clusters found: {n_clusters}
Number of objects: {len([item for items in clusters.values() for item in items])}

For each cluster, I'm providing up to 3 sample images. Please analyze and provide:
1. A description of what type of objects/species are in each cluster
2. Key characteristics that distinguish each cluster
3. Ecological or environmental insights about these findings
4. Recommendations based on the analysis

Format your response as a structured report with sections for each cluster.
"""

    # Prepara i messaggi per OpenAI con le immagini
    messages = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]

    # Aggiungi le immagini di esempio per ogni cluster
    for cluster_id, images_b64 in cluster_samples.items():
        messages[0]["content"].append(
            {
                "type": "text",
                "text": f"\n--- Cluster {cluster_id} ({len(clusters[cluster_id])} objects) ---",
            }
        )
        for img_b64 in images_b64:
            messages[0]["content"].append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{img_b64}"},
                }
            )

    try:
        # Chiama ChatGPT
        response = openai.chat.completions.create(
            model="gpt-4o-mini", messages=messages, max_tokens=2000
        )

        analysis_text = response.choices[0].message.content

        # Genera il PDF
        create_pdf_report(clusters, analysis_text, n_clusters, original_url)

        print(
            f"Report generato con successo: clustering_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
        )

    except Exception as e:
        print(f"Errore nella generazione del report: {str(e)}")


def create_pdf_report(clusters, analysis_text, n_clusters, original_url):
    """Crea il PDF del report"""

    filename = f"/app/clustering_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    doc = SimpleDocTemplate(filename, pagesize=A4)
    story = []

    # Stili
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "CustomTitle",
        parent=styles["Heading1"],
        fontSize=24,
        textColor=colors.HexColor("#2C3E50"),
        spaceAfter=30,
        alignment=TA_CENTER,
    )

    heading_style = ParagraphStyle(
        "CustomHeading",
        parent=styles["Heading2"],
        fontSize=16,
        textColor=colors.HexColor("#34495E"),
        spaceAfter=12,
    )

    # Titolo
    story.append(Paragraph("Drone Survey - Clustering Analysis Report", title_style))
    story.append(Spacer(1, 0.3 * inch))

    # Sommario
    story.append(
        Paragraph(
            f"Analysis Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            styles["Normal"],
        )
    )
    story.append(
        Paragraph(f"Total Clusters Identified: {n_clusters}", styles["Normal"])
    )
    story.append(
        Paragraph(
            f"Total Objects Analyzed: {len([item for items in clusters.values() for item in items])}",
            styles["Normal"],
        )
    )
    story.append(Spacer(1, 0.3 * inch))

    # Analisi di ChatGPT
    story.append(Paragraph("AI Analysis", heading_style))
    for line in analysis_text.split("\n"):
        if line.strip():
            story.append(Paragraph(line, styles["Normal"]))
            story.append(Spacer(1, 0.1 * inch))

    story.append(PageBreak())

    # Dettagli dei cluster con immagini
    story.append(Paragraph("Cluster Details", heading_style))

    for cluster_id, items in sorted(clusters.items()):
        story.append(
            Paragraph(
                f"Cluster {cluster_id} - {len(items)} objects", styles["Heading3"]
            )
        )
        story.append(Spacer(1, 0.2 * inch))

        # Aggiungi fino a 6 immagini per cluster
        images_to_show = items[:6]
        for item in images_to_show:
            img_buffer = BytesIO()
            item["image"].save(img_buffer, format="PNG")
            img_buffer.seek(0)

            # Ridimensiona per il PDF
            img = RLImage(img_buffer, width=2 * inch, height=2 * inch)
            story.append(img)
            story.append(Spacer(1, 0.1 * inch))

        if len(items) > 6:
            story.append(
                Paragraph(f"... and {len(items) - 6} more objects", styles["Italic"])
            )

        story.append(Spacer(1, 0.3 * inch))

    # Build PDF
    doc.build(story)
    print(f"PDF salvato: {filename}")


if __name__ == "__main__":
    print("Server in ascolto sulla porta 5051...")
    app.run(host="0.0.0.0", port=5051, debug=False)
