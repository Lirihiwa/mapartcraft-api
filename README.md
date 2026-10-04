# MapartCraft API

🇬🇧 English | [🇷🇺 Русский](README.ru.md)

A Node.js + Express microservice that turns an image into Minecraft map art.
It is the backend counterpart of [MapartCraft](https://github.com/rebane2001/mapartcraft) and reuses its colour data (`coloursJSON.json`, `ditherMethods.json`, ...) and its colour-matching algorithms.

The service works in **two steps**, so you can look at the result before generating any file:

1. **Preview**: upload an image and settings, get back a preview image and a materials list.
2. **Generate**: ask for a `.nbt` schematic built from that exact preview. Nothing is recalculated.

## Quick start

Requires Node.js 16+.

```bash
cd api
npm install
npm start
```

The server listens on port `3000` (override with the `PORT` environment variable).

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

> The API reads JSON files from `../src/components/mapart/json/`, so keep the `api/` folder inside the MapartCraft repository.

## Docker

Build from the **repository root** (the image needs both `api/` and the JSON data from `src/`):

```bash
docker build -f api/Dockerfile -t mapartcraft-api .
docker run --rm -p 3000:3000 mapartcraft-api
```

The port can be changed with `-e PORT=8080 -p 8080:8080`.

## Usage example

Create `settings.json`:

```json
{
    "mapSize_x": 1,
    "mapSize_y": 1,
    "version": "1.20",
    "staircasing": false,
    "dithering": "FloydSteinberg",
    "selectedBlocks": {
        "13": "0",
        "28": "0",
        "27": "0",
        "24": "0",
        "26": "0",
        "17": "0"
    }
}
```

(white, black, red, blue, green and yellow wool)

**1. Create a preview**

```bash
curl -X POST http://localhost:3000/previews \
  -F "image=@test.png" \
  -F "settings=<settings.json"
```

Response:

```json
{
    "previewId": "c0586cd1-871d-4790-b519-66a7c627fbd6",
    "width": 128,
    "height": 128,
    "imageUrl": "/previews/c0586cd1-871d-4790-b519-66a7c627fbd6/image",
    "materials": [
        {
            "colourSetId": "28",
            "blockId": "0",
            "displayName": "Black Wool",
            "count": 8051
        }
    ]
}
```

**2. Look at the preview** (open in a browser, `scale` enlarges it with nearest-neighbour so pixels stay sharp):

```
http://localhost:3000/previews/<previewId>/image?scale=6
```

**3. Generate the schematic**

```bash
curl -X POST http://localhost:3000/previews/<previewId>/nbt -o mapart.nbt
```

The result is a gzipped `.nbt` file that can be used with a structure block, Litematica, Schematica, cubical.xyz, etc.

## API reference

| Method | Path                  | Description                                                                                                                                     |
| ------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/health`             | Health check.                                                                                                                                   |
| `POST` | `/previews`           | `multipart/form-data` with fields `image` (file) and `settings` (JSON string). Returns `previewId`, `width`, `height`, `imageUrl`, `materials`. |
| `GET`  | `/previews/:id/image` | Preview as PNG. Optional `?scale=1..16`.                                                                                                        |
| `POST` | `/previews/:id/nbt`   | Gzipped `.nbt` schematic built from the stored preview.                                                                                         |

Errors are returned as JSON: `{ "error": "..." }` with status `400` (bad input) or `404` (unknown or expired preview).

### Settings

| Field                            | Default            | Description                                                                                                                   |
| -------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `selectedBlocks`                 | none, **required** | Object `colourSetId → blockId` (see `coloursJSON.json`). `"-1"` means "do not use this colour". At least one block is needed. |
| `mapSize_x`, `mapSize_y`         | `1`                | Size in maps. One map is 128×128 blocks.                                                                                      |
| `version`                        | `"1.20"`           | Minecraft version for block names (`1.12.2` … `1.20`, see `supportedVersions.json`).                                          |
| `staircasing`                    | `true`             | `false` for a flat map (one tone per colour). `true` uses dark/normal/light tones (3× more colours).                          |
| `betterColour`                   | `true`             | Match colours in Lab space instead of RGB.                                                                                    |
| `dithering`                      | `"FloydSteinberg"` | `None`, `FloydSteinberg`, `MinAvgErr`, `Burkes`, `SierraLite`, `Stucki`, `Atkinson`, `Bayer44`, `Bayer22`, `Ordered33`.       |
| `cropMode`                       | `"center"`         | `center`, `manual` or `off` (stretch).                                                                                        |
| `zoom`, `percent_x`, `percent_y` | `10`, `50`, `50`   | Manual crop: zoom `10..50` (10 = whole image), offsets `0..100`.                                                              |
| `preprocessing`                  | off                | `{ "enabled": true, "brightness": 100, "contrast": 100, "saturation": 100 }`, each `0..200`, `100` = unchanged.               |
| `supportBlock`                   | `"cobblestone"`    | Block used for the noobline (the extra row of blocks that shades the first row of the map).                                   |

## Current limitations

This is a first version. Please be aware of the following:

- `.nbt` generation works **only for flat maps** (`"staircasing": false`). Staircased previews work, but `/nbt` rejects them for now.
- Only the noobline is generated. **Support blocks** under sand, carpets, pressure plates etc. are not placed yet.
- **`map.dat` export is not implemented** yet.
- Previews are stored **in memory**: they live for 30 minutes, at most 200 at a time, and are lost on restart.
- No authentication or rate limiting. Do not expose it to the internet as is.
- Brightness/contrast/saturation use `sharp` instead of browser CSS filters, so results can differ slightly from the website.

## Roadmap

- [ ] Support blocks (`Add blocks under` modes)
- [ ] Staircasing (Classic and Valley modes)
- [ ] `map.dat` export
- [ ] Transparency support
- [ ] OpenAPI / Swagger description
- [ ] Automated tests (compare output with the website)
- [x] Dockerfile
- [ ] Persistent preview storage, rate limiting

## Contributing

Contributions are very welcome, whether it is a bug report, an idea, documentation or code. 🙌

1. Fork the repository and create a branch (`git checkout -b feature/my-feature`).
2. Pick something from the roadmap above or open an issue to discuss your idea first.
3. Keep the behaviour consistent with the MapartCraft website: the same image and settings should give the same result.
4. Describe how you tested your change in the pull request.

Good first issues: documentation and translations, tests, input validation, an OpenAPI spec.

## License and credits

This project is a derivative of [MapartCraft](https://github.com/rebane2001/mapartcraft) by rebane2001 and contributors, and is distributed under the **GNU General Public License v3.0**. See the `LICENSE` file in the repository root. Any derivative work must stay under the same license.

Block textures and data belong to Mojang / Minecraft. This project is not affiliated with Mojang or Microsoft.
