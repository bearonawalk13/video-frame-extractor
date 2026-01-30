const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const cloudinary = require('cloudinary').v2;
const fetch = require('node-fetch');
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

// NEW: Extract multiple frames and use AI to pick the best one
app.post('/extract-best-frame', async (req, res) => {
  const {
    video_url,
    timestamps = [0, 0.5, 1, 1.5, 2],  // Extract 5 frames from first 2 seconds
    blur = 400,
    public_id,
    folder = 'frames',
    openrouter_api_key
  } = req.body;

  if (!video_url) {
    return res.status(400).json({ error: 'Missing video_url' });
  }

  const apiKey = openrouter_api_key || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: 'Missing OpenRouter API key' });
  }

  const tempDir = os.tmpdir();
  const tempFiles = [];
  const frameUrls = [];

  try {
    console.log(`Extracting ${timestamps.length} frames from: ${video_url}`);

    // Extract frames at each timestamp
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const tempFile = path.join(tempDir, `frame_${Date.now()}_${i}.jpg`);
      tempFiles.push(tempFile);

      console.log(`Extracting frame at ${ts}s...`);

      await new Promise((resolve, reject) => {
        ffmpeg(video_url)
          .inputOptions(['-ss', String(ts), '-t', '1'])
          .outputOptions(['-vframes', '1', '-q:v', '2'])
          .output(tempFile)
          .on('error', reject)
          .on('end', resolve)
          .run();
      });

      if (!fs.existsSync(tempFile)) {
        throw new Error(`Frame extraction failed at ${ts}s`);
      }

      // Upload to Cloudinary WITHOUT blur (for AI analysis)
      const uploadResult = await cloudinary.uploader.upload(tempFile, {
        folder: folder + '/candidates',
        public_id: `${public_id || 'frame'}_candidate_${i}`
      });

      frameUrls.push({
        index: i,
        timestamp: ts,
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id
      });
    }

    console.log('All frames extracted. Asking AI to pick the best one...');

    // Ask AI to pick the best frame
    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3-5-sonnet',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are analyzing video frames to select the best one for a reel thumbnail.

Pick the BEST frame based on:
1. Facial Expression: Engaged, confident, eyes open, not mid-blink or weird expression
2. Composition: Good framing, person well-positioned
3. Clarity: Not blurry, good lighting
4. No Captions: Prefer frames without burned-in text/captions

RESPOND WITH ONLY THIS JSON (no other text):
{"best_frame_index": 0, "reasoning": "Brief explanation"}`
            },
            ...frameUrls.map((f, idx) => ({
              type: 'image_url',
              image_url: { url: f.url }
            }))
          ]
        }],
        max_tokens: 200
      })
    });

    const aiResult = await aiResponse.json();
    const aiText = aiResult.choices?.[0]?.message?.content || '{"best_frame_index": 0, "reasoning": "Default to first frame"}';

    // Parse AI response
    let bestIndex = 0;
    let reasoning = 'Default selection';
    try {
      const parsed = JSON.parse(aiText);
      bestIndex = parsed.best_frame_index || 0;
      reasoning = parsed.reasoning || 'AI selected';
    } catch (e) {
      console.log('Could not parse AI response, using first frame');
    }

    const bestFrame = frameUrls[bestIndex] || frameUrls[0];
    console.log(`AI selected frame ${bestIndex}: ${reasoning}`);

    // Now upload the best frame WITH blur
    const bestTempFile = tempFiles[bestIndex] || tempFiles[0];
    const finalUpload = await cloudinary.uploader.upload(bestTempFile, {
      folder: folder,
      public_id: public_id,
      transformation: [{ effect: `blur:${blur}` }]
    });

    // Clean up temp files
    tempFiles.forEach(f => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });

    // Delete candidate frames from Cloudinary (optional cleanup)
    for (const frame of frameUrls) {
      try {
        await cloudinary.uploader.destroy(frame.public_id);
      } catch (e) { /* ignore cleanup errors */ }
    }

    return res.json({
      success: true,
      frame_url: finalUpload.secure_url,
      public_id: finalUpload.public_id,
      width: finalUpload.width,
      height: finalUpload.height,
      selected_index: bestIndex,
      selected_timestamp: bestFrame.timestamp,
      reasoning: reasoning,
      blur: blur,
      candidates_analyzed: frameUrls.length
    });

  } catch (error) {
    console.error('Error:', error.message);
    tempFiles.forEach(f => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
    return res.status(500).json({
      error: 'Best frame extraction failed',
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Video Frame Extractor running on port ${PORT}`);
  console.log('Endpoints:');
  console.log('  POST /extract-frame - Extract single frame from any video URL');
  console.log('  POST /extract-best-frame - Extract 5 frames, AI picks the best one');
  console.log('  POST /get-frame-url - Get frame URL for Cloudinary videos');
});
