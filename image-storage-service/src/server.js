import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const PORT = process.env.PORT || 4100;
const STORAGE_DIR = process.env.STORAGE_DIR || path.resolve('uploads');
const BASE_URL = process.env.PUBLIC_BASE_URL;

fs.mkdirSync(STORAGE_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, STORAGE_DIR),
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname) || '.bin';
    cb(null, `${Date.now()}-${uuidv4()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image uploads are allowed.'));
      return;
    }
    cb(null, true);
  }
});

const buildFileUrl = (req, filename) => {
  const origin = BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${origin.replace(/\/$/, '')}/images/${filename}`;
};

app.use('/images', express.static(STORAGE_DIR));

app.post('/api/images', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Image file is required.' });
  }

  const fileUrl = buildFileUrl(req, req.file.filename);
  res.status(201).json({
    filename: req.file.filename,
    mimetype: req.file.mimetype,
    size: req.file.size,
    url: fileUrl
  });
});

app.get('/api/images', async (_req, res) => {
  try {
    const files = await fs.promises.readdir(STORAGE_DIR);
    res.json({ files });
  } catch (error) {
    console.error('Failed to list stored images', error);
    res.status(500).json({ error: 'Unable to list images' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', stored: STORAGE_DIR });
});

app.use((err, _req, res, _next) => {
  console.error('Image storage error:', err.message);
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Image storage service listening on port ${PORT}`);
});
