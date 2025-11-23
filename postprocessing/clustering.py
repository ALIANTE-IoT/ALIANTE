import json
from PIL import Image
import requests
from io import BytesIO
import numpy as np
import supervision as sv
import torch
from transformers import AutoModel, AutoProcessor
from sklearn.cluster import AgglomerativeClustering
from flask import Flask, request, jsonify

# Variabile globale per memorizzare il JSON ricevuto
json_data = None

# Inizializza Flask app
app = Flask(__name__)

@app.route('/receive', methods=['POST'])
def receive_json():
    global json_data
    try:
        json_data = request.get_json()
        print(f"JSON ricevuto: {json_data}")
        # Avvia l'elaborazione
        process_data()
        return jsonify({"status": "success", "message": "JSON ricevuto correttamente"}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


def extract_crop(original_path, mask_path):
    # Load images
    original = original_path.convert('RGB')
    mask = mask_path.convert('RGB')
    
    # Ensure both images have the same size
    if original.size != mask.size:
        raise ValueError(f"Image sizes don't match: original {original.size}, mask {mask.size}")
    
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
    output_array = np.dstack([output_array, np.zeros(original_array.shape[:2], dtype=np.uint8)])  # Add alpha channel
    
    # Copy pixels where mask is red
    output_array[red_mask, :3] = original_array[red_mask]
    output_array[red_mask, 3] = 255  # Set alpha to opaque
    
    # Crop to bounding box
    cropped = output_array[y_min:y_max+1, x_min:x_max+1]
    
    # Convert to PIL Image and save
    output_image = Image.fromarray(cropped, 'RGBA')
    
    return output_image

def print_cluster ():
    clusters = {}
    for id in ids:
        clusters[id] = []

    for i, label in enumerate(labels):
        # print(i, label)
        clusters[label].append(crops[i])

    for id in ids:
        sv.plot_images_grid(
            images=clusters[id],
            grid_size=(10, 10),
            size=(12, 12)
        )

def process_data():
    global json_data
    # accesso a dati
    data = json_data
    image = data['content'][0]['text']
    image_infos = eval(image)

    # url originale immagine
    original_url = image_infos['image']['url']

    # url originale immagine
    mask = image_infos['annotations'][0]['image']['url']


    original_url = image_infos['image']['url']
    original_img = Image.open(BytesIO(requests.get(original_url).content))
    objects = []

    for annotation in image_infos['annotations']:
        annotation_url = annotation['image']['url']
        annotation_img = Image.open(BytesIO(requests.get(annotation_url).content))
        objects.append(annotation_img)
        
    crops = []
    for obj in objects:
        crops.append(extract_crop(original_img, obj))
        
    model = AutoModel.from_pretrained("google/siglip-so400m-patch14-384").vision_model
    processor = AutoProcessor.from_pretrained("google/siglip-so400m-patch14-384")
    model.eval()

    with torch.no_grad():
        inputs = processor(images=crops, return_tensors="pt")
        embeddings = model(**inputs).pooler_output.cpu().numpy()

    clustering = AgglomerativeClustering(n_clusters=None, distance_threshold=20)  # or use distance_threshold
    labels = clustering.fit_predict(embeddings)


if __name__ == '__main__':
    print("Server in ascolto sulla porta 5051...")
    app.run(host='0.0.0.0', port=5051, debug=False)
