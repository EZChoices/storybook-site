# storybook-site

Static landing page + a Vercel Serverless Function (`/api/generate`) that turns uploaded photos into children’s book-style illustrations via the OpenAI Images API.

## Environment variables

Set these in Vercel (Project Settings → Environment Variables) or locally (your shell):

- `OPENAI_API_KEY` (required)
- `OPENAI_IMAGE_MODEL` (optional, default: `gpt-image-1`)
- `OPENAI_IMAGE_SIZE` (optional, default: `512x512`)
- `OPENAI_IMAGE_CONCURRENCY` (optional, default: `2`)

## Local dev

```bash
npm install
npx vercel dev
```

Then open the served URL and use the “Generate Preview” button.

## API

`POST /api/generate` (multipart/form-data)

Fields:

- `photos` (up to 12 files)
- `style` (string)
- `childName` (string)
- `lang` (string)

Response:

```json
{
  "images": [
    { "filename": "photo_1.jpg", "b64_png": "..." }
  ]
}
```

