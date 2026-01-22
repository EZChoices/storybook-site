# storybook-site

Static site + a Vercel Serverless Function (`/api/generate`) that turns a bulk photo upload into a 6-page illustrated story preview via the OpenAI Images API.

## Environment variables (Vercel)

Set this in Vercel (Project Settings → Environment Variables):

- `OPENAI_API_KEY` (required)

Optional tuning (not required):

- `OPENAI_IMAGE_MODEL` (default: `gpt-image-1.5`)
- `OPENAI_IMAGE_SIZE` (default: `1024x1024`; supported: `1024x1024`, `1024x1536`, `1536x1024`, `auto`)
- `OPENAI_IMAGE_CONCURRENCY` (default: `2`)
- `OPENAI_REQUEST_TIMEOUT_MS` (optional)

Never commit secrets. Don’t store the key in GitHub Actions variables.

## Local dev

```bash
npm install
npx vercel dev
```

Then open the served URL and use the “Generate Preview” button.

## API

`POST /api/generate` (multipart/form-data)

Fields:

- `templateId` (required; currently `mom-love-0-3`)
- `style` (optional; default `Watercolor`)
- `childName` (optional)
- `lang` (optional; default `English`)
- `photos[]` (1–12 image files)

Response:

```json
{
  "templateId": "mom-love-0-3",
  "style": "Watercolor",
  "pages": [
    { "pageIndex": 1, "role": "Opening", "caption": "To Mom, with love.", "b64_png": "..." }
  ]
}
```

