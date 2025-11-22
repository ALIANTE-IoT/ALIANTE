import os
import json
import base64
import numpy as np
import cv2
from PIL import Image
import google.generativeai as genai
from sklearn.cluster import MeanShift, estimate_bandwidth
import matplotlib.pyplot as plt
from dotenv import load_dotenv

load_dotenv()

class TreeAnalysisPipeline:
    def __init__(self, gemini_api_key):
        genai.configure(api_key=gemini_api_key)
        self.model = genai.GenerativeModel('gemini-2.0-flash-exp')
        
    def encode_image_to_base64(self, image_path):
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode('utf-8')
    
    def call_gemini_api(self, prompt, image_path):
        try:
            img = Image.open(image_path)
            response = self.model.generate_content([prompt, img])
            result = {
                "status": "success",
                "prompt": prompt,
                "response": response.text,
                "image_path": image_path
            }
            return result
            
        except Exception as e:
            return {
                "status": "error",
                "error": str(e),
                "prompt": prompt,
                "image_path": image_path
            }
    
    def segment_with_sam(self, image_path, point_coords=None):
        img = cv2.imread(image_path)
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        img_lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        if point_coords is None:
            mask = np.zeros(img.shape[:2], np.uint8)
            rect = (10, 10, img.shape[1]-10, img.shape[0]-10)
            bgd_model = np.zeros((1, 65), np.float64)
            fgd_model = np.zeros((1, 65), np.float64)
            cv2.grabCut(img, mask, rect, bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_RECT)
            mask2 = np.where((mask == 2) | (mask == 0), 0, 1).astype('uint8')
            
        else:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            ret, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
            
            kernel = np.ones((3, 3), np.uint8)
            opening = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=2)
            sure_bg = cv2.dilate(opening, kernel, iterations=3)
            dist_transform = cv2.distanceTransform(opening, cv2.DIST_L2, 5)
            ret, sure_fg = cv2.threshold(dist_transform, 0.7 * dist_transform.max(), 255, 0)
            sure_fg = np.uint8(sure_fg)
            unknown = cv2.subtract(sure_bg, sure_fg)
            ret, markers = cv2.connectedComponents(sure_fg)
            markers = markers + 1
            markers[unknown == 255] = 0
            
            markers = cv2.watershed(img, markers)
            mask2 = np.where(markers > 1, 1, 0).astype('uint8')
        
        return mask2, img_rgb
    
    def apply_mean_shift_clustering(self, image, mask, bandwidth=None):
        
        masked_pixels = image[mask == 1]
        
        if len(masked_pixels) == 0:
            return None, 0, None, []
        if bandwidth is None:
            bandwidth = estimate_bandwidth(masked_pixels, quantile=0.2, n_samples=500)
        ms = MeanShift(bandwidth=bandwidth, bin_seeding=True)
        ms.fit(masked_pixels)
        labels = ms.labels_
        
        n_clusters = len(np.unique(labels))
        clustered_image = np.zeros_like(image)
        label_idx = 0
        for i in range(image.shape[0]):
            for j in range(image.shape[1]):
                if mask[i, j] == 1:
                    cluster_label = labels[label_idx]
                    clustered_image[i, j] = ms.cluster_centers_[cluster_label]
                    label_idx += 1
        cluster_images = []
        for cluster_id in range(n_clusters):
            cluster_mask = np.zeros_like(mask)
            label_idx = 0
            for i in range(image.shape[0]):
                for j in range(image.shape[1]):
                    if mask[i, j] == 1:
                        if labels[label_idx] == cluster_id:
                            cluster_mask[i, j] = 1
                        label_idx += 1
            cluster_img = image.copy()
            cluster_img[cluster_mask == 0] = [255, 255, 255]
            cluster_images.append(cluster_img)
        
        return labels, n_clusters, clustered_image, cluster_images
    
    def analyze_tree_clusters(self, cluster_images, original_image_path):
        results = []
        
        for idx, cluster_img in enumerate(cluster_images):
            temp_path = f"temp_cluster_{idx}.png"
            cv2.imwrite(temp_path, cv2.cvtColor(cluster_img, cv2.COLOR_RGB2BGR))
            
            prompt = f"""Analizza questo cluster di vegetazione e determina:
1. Che tipo di albero/pianta è probabile che sia
2. Caratteristiche distintive visibili (forma foglie, colore, texture)
3. Livello di confidenza nell'identificazione (basso/medio/alto)
4. Note aggiuntive

Rispondi in formato JSON con i campi: tree_type, characteristics, confidence, notes"""
            result = self.call_gemini_api(prompt, temp_path)
            result['cluster_id'] = idx
            results.append(result)
            if os.path.exists(temp_path):
                os.remove(temp_path)
        
        return results
    
    def run_full_pipeline(self, image_path, initial_prompt=None, point_coords=None):
        initial_prompt = """Analizza questa immagine e fornisci una panoramica generale:
                            - Quanti alberi o gruppi di vegetazione sono visibili?
                            - Quali sono le caratteristiche generali dell'ambiente?
                            - Ci sono diversi tipi di vegetazione?"""
        results = {
            "image_path": image_path,
            "pipeline_steps": []
        }
        
        if initial_prompt:
            print("Step 1: Analisi iniziale con Gemini...")
            initial_analysis = self.call_gemini_api(initial_prompt, image_path)
            results["initial_analysis"] = initial_analysis
            results["pipeline_steps"].append("initial_gemini_analysis")
        print("Step 2: Segmentazione immagine...")
        mask, img_rgb = self.segment_with_sam(image_path, point_coords)
        results["segmentation"] = {
            "method": "grabcut_watershed",
            "segmented_pixels": int(np.sum(mask))
        }
        results["pipeline_steps"].append("segmentation")
        
        segmented_img = img_rgb.copy()
        segmented_img[mask == 0] = [0, 0, 0]
        cv2.imwrite("segmented_result.png", cv2.cvtColor(segmented_img, cv2.COLOR_RGB2BGR))
        
        print("Step 3: Clustering con Mean Shift...")
        labels, n_clusters, clustered_img, cluster_images = self.apply_mean_shift_clustering(
            img_rgb, mask
        )
        results["clustering"] = {
            "method": "mean_shift",
            "n_clusters": n_clusters
        }
        results["pipeline_steps"].append("mean_shift_clustering")
        if clustered_img is not None:
            cv2.imwrite("clustered_result.png", cv2.cvtColor(clustered_img.astype(np.uint8), cv2.COLOR_RGB2BGR))
        print(f"Step 4: Analisi {n_clusters} cluster con Gemini...")
        cluster_analysis = self.analyze_tree_clusters(cluster_images, image_path)
        results["cluster_analysis"] = cluster_analysis
        results["pipeline_steps"].append("cluster_tree_identification")
        
        return results
    
    def only_geminai_pipeline(self, image_path, initial_prompt=None, point_coords=None):
        results = {
            "image_path": image_path,
            "pipeline_steps": []
        }   
        if initial_prompt:
            print("Analisi iniziale con Gemini...")
            initial_analysis = self.call_gemini_api(initial_prompt, image_path)
            results["initial_analysis"] = initial_analysis
            results["pipeline_steps"].append("initial_gemini_analysis")
        prompt = """Analizza questa immagine e fornisci una panoramica dettagliata sugli alberi e la vegetazione presenti, includendo:
                    1. Numero di alberi o gruppi di vegetazione visibili
                    2. Tipi di alberi o piante identificabili
                    3. Caratteristiche distintive visibili (forma foglie, colore, texture)
                    4. Condizioni generali dell'ambiente (salute della vegetazione, presenza di malattie)
                    5. Note aggiuntive rilevanti"""
        geminai_analysis = self.call_gemini_api(prompt, image_path)
        results["geminai_full_analysis"] = geminai_analysis
        results["pipeline_steps"].append("geminai_full_analysis")
        return results
    
        
    
    def save_results(self, results, output_path="tree_analysis_results.json"):
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        print(f"\nRisultati salvati in: {output_path}")



if __name__ == "__main__":
    
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
    
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY non trovata nel file .env")
    
    pipeline = TreeAnalysisPipeline(GEMINI_API_KEY)
    image_path = "/Users/gregoriopetruzzi/Downloads/asecond.jpg"
    
    for m in genai.list_models():
        if 'generateContent' in m.supported_generation_methods:
            print(m.name)
   
    results = pipeline.only_geminai_pipeline(
        image_path=image_path,
        point_coords=None 
    )
    print("\n=== RISULTATI PIPELINE SOLO GEMINAI ===")  
    print(json.dumps(results, indent=2, ensure_ascii=False))
    pipeline.save_results(results)

    print("\n=== SOMMARIO ANALISI ===")
    print(f"Immagine: {results['image_path']}")
    print(f"Steps completati: {', '.join(results['pipeline_steps'])}")
    if 'clustering' in results:
        print(f"Cluster identificati: {results['clustering']['n_clusters']}")
    print(f"\nDettagli completi salvati in: tree_analysis_results.json")