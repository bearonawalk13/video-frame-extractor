const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');
const os = require('os');

// Use system ffmpeg (installed via Dockerfile or nixpacks)
// No need to set path - fluent-ffmpeg will find it in PATH

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dviqqrjfe',
  api_key: process.env.CLOUDINARY_API_KEY || '169455155531379',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'wVGegUSi_CwTo32HtfM2G2vZpo4'
});

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'video-frame-extractor' });
});

// Main endpoint: extract frame from video URL
app.post('/extract-frame', async (req, res) => {
  const {
    video_url,
    timestamp = 0,         // Seconds into video (default: first frame)
    blur = 400,            // Blur amount (Cloudinary e_blur value)
    public_id,             // Optional: Cloudinary public_id for the frame
    folder = 'frames'      // Cloudinary folder
  } = req.body;

  if (!video_url) {
    return res.status(400).json({ error: 'Missing video_url' });
  }

  // Create temp file for the frame
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `frame_${Date.now()}.jpg`);

  try {
    console.log(`Extracting frame from: ${video_url}`);
    console.log(`Timestamp: ${timestamp}s`);

    // Extract frame using ffmpeg
    // Key: -t 1 tells ffmpeg to only read 1 second of video data (very fast)
    await new Promise((resolve, reject) => {
      ffmpeg(video_url)
        .inputOptions([
          '-ss', String(timestamp),  // Seek to timestamp
          '-t', '1'                  // Only read 1 second (minimal data transfer)
        ])
        .outputOptions([
          '-vframes', '1',           // Extract only 1 frame
          '-q:v', '2'                // High quality JPEG
        ])
        .output(tempFile)
        .on('start', (cmd) => console.log('FFmpeg command:', cmd))
        .on('error', (err) => {
          console.error('FFmpeg error:', err.message);
          reject(err);
        })
        .on('end', () => {
          console.log('Frame extracted successfully');
          resolve();
        })
        .run();
    });

    // Check if frame was created
    if (!fs.existsSync(tempFile)) {
      throw new Error('Frame extraction failed - no output file');
    }

    // Upload to Cloudinary with blur transformation
    console.log('Uploading to Cloudinary...');
    const uploadOptions = {
      folder: folder,
      transformation: [
        { effect: `blur:${blur}` }
      ]
    };

    if (public_id) {
      uploadOptions.public_id = public_id;
    }

    const uploadResult = await cloudinary.uploader.upload(tempFile, uploadOptions);

    // Clean up temp file
    fs.unlinkSync(tempFile);

    console.log('Upload complete:', uploadResult.secure_url);

    return res.json({
      success: true,
      frame_url: uploadResult.secure_url,
      public_id: uploadResult.public_id,
      width: uploadResult.width,
      height: uploadResult.height,
      timestamp: timestamp,
      blur: blur
    });

  } catch (error) {
    console.error('Error:', error.message);

    // Clean up temp file if it exists
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }

    return res.status(500).json({
      error: 'Frame extraction failed',
      details: error.message
    });
  }
});

// Alternative: Get frame URL without uploading (uses Cloudinary transformation on-the-fly)
// This only works if the video is already in Cloudinary
app.post('/get-frame-url', (req, res) => {
  const {
    cloudinary_video_url,
    timestamp = 0,
    blur = 400
  } = req.body;

  if (!cloudinary_video_url) {
    return res.status(400).json({ error: 'Missing cloudinary_video_url' });
  }

  // Extract public_id from Cloudinary URL
  const match = cloudinary_video_url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z]+)?$/i);
  if (!match) {
    return res.status(400).json({ error: 'Invalid Cloudinary URL' });
  }

  const publicId = match[1];
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dviqqrjfe';

  // Generate frame URL with transformation
  const frameUrl = `https://res.cloudinary.com/${cloudName}/video/upload/so_${timestamp},e_blur:${blur}/${publicId}.jpg`;

  return res.json({
    success: true,
    frame_url: frameUrl,
    public_id: publicId,
    timestamp: timestamp,
    blur: blur
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Video Frame Extractor running on port ${PORT}`);
  console.log('Endpoints:');
  console.log('  POST /extract-frame - Extract frame from any video URL');
  console.log('  POST /get-frame-url - Get frame URL for Cloudinary videos');
});
