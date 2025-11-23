FROM python:3.11-slim

WORKDIR /app

# Installa dipendenze di sistema per OpenCV, PIL e librerie di machine learning
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copia requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia il codice
COPY clustering.py .

EXPOSE 5051

CMD ["python", "clustering.py"]
