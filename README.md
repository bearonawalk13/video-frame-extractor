# Video Frame Extractor

Extracts frames from any video URL - handles files of ANY SIZE by streaming only the first few seconds.

## Quick Deploy to Railway (Recommended)

1. **Click the button below** to deploy:

   [![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/bearonawalk13/video-frame-extractor)

2. **Set environment variables** (Railway will prompt):
   - `CLOUDINARY_CLOUD_NAME`: dviqqrjfe
   - `CLOUDINARY_API_KEY`: (from your .env)
   - `CLOUDINARY_API_SECRET`: (from your .env)

3. **Copy the deployed URL** (e.g., `https://video-frame-extractor-xxx.up.railway.app`)

4. **Update WF3.5** to use this URL

## Manual Deploy to Render.com

1. Create new Web Service on render.com
2. Connect to this GitHub repo
3. Set environment variables
4. Deploy

## API Endpoints

### POST /extract-frame

Extract a frame from ANY video URL (handles large files).

**Request:**
```json
{
  "video_url": "https://example.com/large-video.mp4",
  "timestamp": 0,
  "blur": 400,
  "public_id": "optional_cloudinary_id",
  "folder": "frames"
}
```

**Response:**
```json
{
  "success": true,
  "frame_url": "https://res.cloudinary.com/...",
  "public_id": "frames/xxx",
  "width": 1920,
  "height": 1080,
  "timestamp": 0,
  "blur": 400
}
```

### POST /get-frame-url

For videos already in Cloudinary - generates frame URL without extraction.

**Request:**
```json
{
  "cloudinary_video_url": "https://res.cloudinary.com/.../video.mp4",
  "timestamp": 0,
  "blur": 400
}
```

## How It Works

1. Uses ffmpeg with `-ss 0 -t 1` to read only the first 1 second of video data
2. Extracts frame 0 (very fast, minimal data transfer)
3. Uploads the small frame image to Cloudinary with blur
4. Returns the Cloudinary URL

This means a 5GB video takes the same time to process as a 50MB video!

## Local Testing

```bash
npm install
npm start
# Server runs on port 3000

# Test:
curl -X POST http://localhost:3000/extract-frame \
  -H "Content-Type: application/json" \
  -d '{"video_url": "https://example.com/video.mp4", "blur": 400}'
```
