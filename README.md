## 0. Assegnazione ruoli (fisso da subito)

Non per gerarchia ma per responsabilità primaria.

1. **Persona A – Owner prodotto / dominio (AXA mindset)**

   * Tiene il filo dell’obiettivo assicurativo.
   * Scrive i casi d’uso, i template di report, il pitch.
2. **Persona B – Backend / integrazione servient + VLM**

   * Si occupa del servient, del simulatore, delle API, orchestrazione chiamate.
3. **Persona C – Agent / agentspec designer**

   * Definisce tools, policy, stato dell’agente, logica decisionale.
4. **Persona D – Frontend / demo / UX**

   * Fa la dashboard, timeline, visualizzazioni, flusso demo.

Ovviamente ci si aiuta, ma le responsabilità principali non cambiano.

---

## 1. Definire bene *che problema risolviamo* (AXA)

**Responsabile:** A (con input da tutti)

1. Scrivere in 5 righe massimo:

   * Chi è l’utente: es. *perito / underwriter AXA*.
   * Cosa vuole: ridurre tempo e soggettività nelle ispezioni rischio incendio.
   * Cosa fa il nostro sistema: analizza immagini drone → estrai fattori di rischio → genera profilo + report.

2. Definire **2–3 scenari concreti** (molto specifici):

   * Casa unifamiliare circondata da vegetazione secca.
   * Capannone con materiali stoccati fuori, vicino a vegetazione.
   * (Optional) Struttura “virtuosa” a basso rischio per confronto.

3. Elencare i **fattori di rischio visibili** per ogni scenario:

   * Distanza vegetazione–struttura.
   * Vegetazione secca / alta.
   * Presenza materiali combustibili (pallet, rifiuti, serbatoi).
   * Stato tetto (sporco, foglie, oggetti).
   * Accessibilità (stradine strette, ostacoli ai mezzi di soccorso).
   * Presenza apparecchi “caldi” (barbecue, generatori) vicino a materiali combustibili.

4. Definire un **output finale desiderato**:

   * Livello di rischio: `low | medium | high`.
   * Elenco fattori rilevati.
   * 2–3 raccomandazioni concrete.
   * Un “punteggio” opzionale (0–100) solo come sintesi.

---

## 2. Definire il modello dati / JSON di rischio

**Responsabile:** A + C

1. Disegnare lo **schema JSON target** che userà tutto il sistema. Esempio:

```json
{
  "location_id": "area_1",
  "risk_summary": {
    "score": 73,
    "level": "high",
    "main_drivers": [
      "high_vegetation_density_near_building",
      "combustible_storage_near_entrance"
    ]
  },
  "fire_exposure": {
    "vegetation_density": "high",
    "vegetation_distance_to_structure_m": 5,
    "slope": "medium"
  },
  "structural_risk": {
    "roof_condition": "poor",
    "roof_debris": true,
    "solar_panels": "present_unknown_maintenance"
  },
  "operational_risk": {
    "access_for_firetrucks": "limited",
    "combustible_storage": ["wood_pallets"],
    "human_activity_signs": ["barbecue_area"]
  },
  "evidence": [
    {
      "image_id": "frame_12",
      "finding": "dense_vegetation_close_to_wall",
      "approx_distance_m": 3
    }
  ]
}
```

2. Decidere:

   * Quali campi vengono dal **VLM** (direttamente dall’immagine).
   * Quali campi vengono dall’**agente** (aggregazione, score, main_drivers).

3. Fissare questo schema una volta sola e non toccarlo più se non per emergenze → tutto il resto del codice lavora per riempirlo.

---

## 3. Pipeline end-to-end: cosa succede in che ordine

**Responsabile:** B + C

Scrivere il flusso in 6 step chiari:

1. L’utente (AXA) seleziona **un’area da ispezionare**.
2. L’agente:

   * pilota il drone nel simulatore lungo un perimetro predefinito,
   * acquisisce immagini chiave (frame).
3. Ogni immagine:

   * passa al VLM con un prompt che chiede di riempire *una parte* del JSON (fattori visivi).
4. L’agente:

   * aggrega i risultati per tutta l’area,
   * calcola score, livello di rischio, motivazioni.
5. Backend:

   * salva il risultato,
   * espone un endpoint tipo `/areas/{id}/risk_profile`.
6. Frontend:

   * mostra mappa/percorso drone,
   * lista dei fattori di rischio,
   * score/level,
   * bottone “genera report”.

---

## 4. Simulatore + servient + immagini

**Responsabile:** B

Checklist:

1. Confermare:

   * come si comanda il drone nel simulatore (API del servient),
   * come si recuperano immagini (stream, snapshot, file…).

2. Implementare una piccola libreria interna:

   * `move_drone_to(waypoint)`.
   * `get_current_frame() -> image`.
   * `scan_perimeter(area_definition) -> [image_1, image_2, ...]`.

3. Decidere una rappresentazione dell’area:

   * Semplice: lista di waypoint (poligono).
   * Per hackathon basta hardcodare 2–3 percorsi predefiniti.

4. Testing minimo:

   * Script che:

     * lancia il drone sul percorso,
     * salva localmente 5–10 immagini in una cartella,
     * stampa gli ID/frame usati.

---

## 5. VLM: prompt e parsing

**Responsabile:** C (con supporto B)

1. Definire il **prompt di base** per il VLM, coerente col JSON definito in §2:

   * Istruzioni chiare:

     * “Analizza l’immagine come ispettore assicurativo, non come vigile del fuoco.”
     * “Rispondi SOLO in JSON valido con questo schema…”
   * Dare 1–2 esempi nel prompt (few-shot) se possibile.

2. Implementare una funzione:

   * `analyze_image_with_vlm(image) -> partial_json`
   * che:

     * manda l’immagine + prompt al modello,
     * fa sanity-check del JSON (chiavi presenti, tipi coerenti),
     * in caso di errore:

       * logga,
       * tenta un retry con prompt di correzione (facoltativo),
       * al limite ritorna un JSON “vuoto” con un campo `uncertain: true`.

3. Test rapido:

   * Usare 3–4 immagini “campione” dal simulatore.
   * Stampare a console il JSON di risposta.
   * Controllare a mano se:

     * i campi sono coerenti,
     * ci sono hallucination totali,
     * i valori qualitativi (low/medium/high) hanno senso.

---

## 6. Definizione dell’agente (agentspec)

**Responsabile:** C

### 6.1. Definire i tools

Tools minimi:

* `scan_area(area_id) -> [frame_ids]`
* `get_frame(frame_id) -> image`
* `analyze_frame(frame_id) -> vlm_partial_json`
* `aggregate_findings(area_id, findings[]) -> risk_profile_json`
* `save_risk_profile(area_id, risk_profile)`
* `get_previous_risk_profiles(area_id) -> [risk_profile]` (optional)

### 6.2. Definire lo stato interno

* `current_area_id`
* `scanned_frames`
* `findings_by_frame`
* `final_risk_profile`
* `log` (lista di azioni/finding per fare debug e per la demo)

### 6.3. Definire la policy comportamentale

Scrivere testualmente (poi convertirlo in agentspec):

1. All’inizio:

   * chiedi/ottieni `area_id`.
   * chiama `scan_area(area_id)` per ottenere i frame.
2. Per ciascun frame:

   * chiama `analyze_frame(frame_id)`,
   * salva i risultati in `findings_by_frame`.
3. Dopo aver analizzato tutti i frame:

   * chiama `aggregate_findings(...)` per produrre il JSON finale.
4. Chiama `save_risk_profile(...)`.
5. Restituisci all’utente:

   * `score`, `level`, `main_drivers`,
   * un riassunto testuale breve (3–5 frasi) per l’umano.

---

## 7. Backend / orchestrazione

**Responsabile:** B

1. Esporre un’API semplice (REST):

   * `POST /areas/{id}/scan`
     → fa partire l’agente, ritorna `risk_profile`.
   * `GET /areas/{id}/risk_profile`
     → ritorna l’ultimo profilo.
   * (Optional) `GET /areas`
     → lista aree di test predefinite.

2. Implementare la chiamata all’agente:

   * wrapper che:

     * istanzia l’agente,
     * gli passa `area_id`,
     * lo lascia eseguire fino a `risk_profile_json`.

3. Logging:

   * Loggare:

     * errori del VLM,
     * tempi delle chiamate,
     * numero di frame analizzati.

---

## 8. Frontend / demo UI

**Responsabile:** D

Obiettivo: demo super chiara in 30–60 secondi.

1. Schermata principale:

   * Lista di aree demo:

     * “Casa in collina – scenario alto rischio”
     * “Capannone – scenario medio”
   * Bottone “Analizza con drone AI”.

2. Quando si lancia l’analisi:

   * Mostrare:

     * un mini player / sequenza di immagini del drone (anche fake, basta che sembri coerente).
     * un indicatore di “analisi in corso”.
   * Alla fine mostra:

     * **Score** grande (es. 73/100, livello HIGH).
     * Lista di **driver principali** (3 bullet).
     * Una mappa / schema con pin sui punti critici (anche semplificata).

3. Selezionando un finding:

   * Mostrare l’immagine associata (frame) + highlight del rischio (anche solo un box approssimativo o testo).

4. Bottone “Genera report”:

   * Mostra un riepilogo testuale:

     * descrizione breve del rischio,
     * elenco fattori,
     * 2–3 raccomandazioni.

---

## 9. Report finale (per AXA / giuria)

**Responsabile:** A + D

1. Definire un template di report:

   * Intestazione: area, data, tipo struttura.
   * Score + livello rischio.
   * Tabella fattori:

     * Fattore | Impatto | Evidenza (frame n° / descrizione).
   * Raccomandazioni:

     * breve testo action-oriented.

2. Implementarlo:

   * come pagina web stampabile **o**
   * come semplice componente nella UI.

---

## 10. Testing & scenari demo

**Responsabili:** Tutti, ma B + C guidano

1. Preparare **due run standard** da usare per la demo:

   * Run “rischio alto”: aria marcia, vegetazione ovunque, pallet vicino alla parete.
   * Run “rischio medio/basso”: condizioni migliori.

2. Per ogni run:

   * salvare il JSON di output,
   * verificare che:

     * score e livello abbiano senso,
     * i driver siano coerenti con ciò che si vede.

3. Fare una prova demo completa:

   * da UI → chiamata backend → simulatore → VLM → agente → risultato in UI.
   * Segnarsi dove il flusso è lento, instabile o poco chiaro da spiegare.

---

## 11. Pitch / presentazione

**Responsabile:** A (con feedback da tutti)

1. Struttura pitch:

   1. Problema:

      * “Ispezioni manuali, lente, soggettive.”
   2. Soluzione:

      * “Agente AI che usa droni + VLM per creare profili di rischio incendio assicurativi.”
   3. Demo:

      * Live o video di 60–90 secondi.
   4. Perché è rilevante per AXA:

      * underwriting, rinnovi, loss prevention.
   5. Limiti e next step:

      * supporto decisionale, non sostituisce periti.

2. Preparare 2–3 frasi chiave tipo mantra da ripetere uguali ogni volta.

---

## 12. Controllo realtà (check brutale finale)

**Tutti insieme, ultima fase**

* Chiedervi:

  1. **Si vede chiaramente che è per un assicuratore?**
     Se sembra solo “drone che guarda il fuoco”, avete sbagliato.
  2. **L’agente fa qualcosa di non banale?**
     Se è solo un proxy verso il VLM, avete sbagliato.
  3. **Il flusso demo è chiaro anche a uno non tecnico in 1 minuto?**
     Se serve spiegare 3 minuti di architettura, avete sbagliato.
