import * as fs from 'fs/promises';
import * as path from 'path';
import { geminiService } from '../ai/geminiService';

const PHOTO_DIRS = [
  'C:\\Users\\Usuario\\Pictures\\FOTOS PROY3',
  'C:\\Users\\Usuario\\Documents\\FOTOS PROY3',
  'C:\\Users\\Usuario\\Desktop\\FOTOS PROY3',
  'D:\\FOTOS PROY3',
  'E:\\FOTOS PROY3',
];

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG'];

interface LoadTestResult {
  success: boolean;
  filePath?: string;
  fileSize?: number;
  readTime?: number;
  encodeTime?: number;
  apiTime?: number;
  totalTime?: number;
  response?: string;
  error?: string;
}

async function findFirstImage(baseDirs: string[]): Promise<string | null> {
  for (const dir of baseDirs) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (IMAGE_EXTENSIONS.includes(ext)) {
            return path.join(dir, entry.name);
          }
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function readImageAsBase64(filePath: string): Promise<{ base64: string; mimeType: string; size: number }> {
  const buffer = await fs.readFile(filePath);
  const base64 = buffer.toString('base64');
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  
  return { base64, mimeType, size: buffer.length };
}

export async function runMultimodalLoadTest(): Promise<LoadTestResult> {
  const startTime = Date.now();
  const result: LoadTestResult = { success: false };

  console.log('\n' + '='.repeat(60));
  console.log('[Load Test] Multimodal Image Analysis - PROY_03_RADARFONDOS');
  console.log('='.repeat(60));

  try {
    const imagePath = await findFirstImage(PHOTO_DIRS);
    
    if (!imagePath) {
      result.error = `No images found in directories: ${PHOTO_DIRS.join(', ')}`;
      console.log(`[Load Test] ${result.error}`);
      return result;
    }

    console.log(`[Load Test] Found image: ${imagePath}`);
    result.filePath = imagePath;

    const readStart = Date.now();
    const { base64, mimeType, size } = await readImageAsBase64(imagePath);
    result.readTime = Date.now() - readStart;
    result.fileSize = size;
    
    console.log(`[Load Test] Read time: ${result.readTime}ms`);
    console.log(`[Load Test] File size: ${(size / 1024).toFixed(2)}KB`);

    const encodeStart = Date.now();
    result.encodeTime = Date.now() - encodeStart;

    console.log(`[Load Test] Sending to Gemini...`);
    const apiStart = Date.now();
    
    const response = await geminiService.generateMultimodalContent(
      `[PROJECT_SCOPE: PROY_03_RADARFONDOS]
Analyze this image for the Radar 360 Fondos project.

Return a brief JSON response with:
{
  "description": "What is in this image",
  "relevance": "How it relates to funding opportunities (1-10)",
  "tags": ["relevant", "tags"]
}

Keep response under 100 words.`,
      base64,
      mimeType
    );
    
    result.apiTime = Date.now() - apiStart;
    result.response = response;
    
    result.totalTime = Date.now() - startTime;
    
    console.log(`[Load Test] API response time: ${result.apiTime}ms`);
    console.log(`[Load Test] TOTAL TIME: ${result.totalTime}ms`);
    
    if (result.totalTime < 3000) {
      console.log('[Load Test] ✅ PASS - Response time under 3 seconds');
      result.success = true;
    } else {
      console.log('[Load Test] ❌ FAIL - Response time exceeded 3 seconds');
    }
    
    console.log('\n--- Response ---');
    console.log(response);
    console.log('='.repeat(60) + '\n');
    
    return result;
    
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    result.totalTime = Date.now() - startTime;
    console.error(`[Load Test] Error: ${result.error}`);
    console.log('='.repeat(60) + '\n');
    return result;
  }
}

export async function scanAndIndexPhotos(): Promise<{ count: number; paths: string[] }> {
  const paths: string[] = [];
  
  for (const dir of PHOTO_DIRS) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (IMAGE_EXTENSIONS.includes(ext)) {
            paths.push(path.join(dir, entry.name));
          }
        }
      }
    } catch {
      continue;
    }
  }
  
  return { count: paths.length, paths };
}

export async function runPhotoScanTest(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('[Photo Scan] Scanning FOTOS PROY3 directories...');
  console.log('='.repeat(60));
  
  const scanStart = Date.now();
  const results = await scanAndIndexPhotos();
  const scanTime = Date.now() - scanStart;
  
  console.log(`[Photo Scan] Found ${results.count} images in ${scanTime}ms`);
  
  if (results.paths.length > 0) {
    console.log('\n[Photo Scan] Sample paths:');
    results.paths.slice(0, 5).forEach(p => console.log(`  - ${p}`));
  }
  
  console.log('='.repeat(60) + '\n');
}

export const PHOTO_DIRECTORIES = PHOTO_DIRS;
export { findFirstImage, readImageAsBase64 };
export default {
  runMultimodalLoadTest,
  runPhotoScanTest,
  scanAndIndexPhotos,
  PHOTO_DIRECTORIES,
};