const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const crypto = require("crypto");
const zlib = require("zlib");
const {
    buildPalette,
    quantize,
    quantizeErrorDiffusion,
    quantizeOrdered,
    ditherMethods,
} = require("./colours");
const { countMaterials } = require("./materials");
const { buildSchematic } = require("./schematic");

const app = express();
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const previews = new Map();
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_PREVIEWS = 200;

setInterval(() => {
    const now = Date.now();
    for (const [id, preview] of previews) {
        if (now - preview.createdAt > PREVIEW_TTL_MS) {
            previews.delete(id);
        }
    }
}, 60 * 1000).unref();

app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});

app.post("/previews", upload.single("image"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "Поле 'image' обязательно" });
    }

    let settings;
    try {
        settings = JSON.parse(req.body.settings || "{}");
    } catch (e) {
        return res
            .status(400)
            .json({ error: "Поле 'settings' должно быть валидным JSON" });
    }

    const mapSize_x = settings.mapSize_x || 1;
    const mapSize_y = settings.mapSize_y || 1;
    const cropMode = settings.cropMode || "center";

    const selectedBlocks = settings.selectedBlocks || {};
    const toneKeys =
        settings.staircasing === false
            ? ["normal"]
            : ["dark", "normal", "light"];
    const betterColour = settings.betterColour !== false;
    const palette = buildPalette(selectedBlocks, toneKeys);
    const ditherName = settings.dithering || "FloydSteinberg";
    const ditherMethod = ditherMethods[ditherName];
    if (!ditherMethod) {
        return res
            .status(400)
            .json({ error: `Неизвестный dithering: ${ditherName}` });
    }
    if (palette.length === 0) {
        return res
            .status(400)
            .json({ error: "Выбери хотя бы один блок в selectedBlocks" });
    }

    try {
        let pipeline = sharp(req.file.buffer);

        if (cropMode !== "off") {
            const meta = await pipeline.metadata();
            const imgW = meta.width;
            const imgH = meta.height;
            const zoom = Math.min(Math.max(settings.zoom || 10, 10), 50);
            const percentX = Math.min(
                Math.max(settings.percent_x ?? 50, 0),
                100,
            );
            const percentY = Math.min(
                Math.max(settings.percent_y ?? 50, 0),
                100,
            );

            let sw;
            let sh;
            if (imgW * mapSize_y > imgH * mapSize_x) {
                sw = Math.floor((10 * imgH * mapSize_x) / (mapSize_y * zoom));
                sh = Math.floor((10 * imgH) / zoom);
            } else {
                sw = Math.floor((10 * imgW) / zoom);
                sh = Math.floor((10 * imgW * mapSize_y) / (mapSize_x * zoom));
            }
            sw = Math.max(1, Math.min(sw, imgW));
            sh = Math.max(1, Math.min(sh, imgH));

            pipeline = pipeline.extract({
                left: Math.floor((percentX * (imgW - sw)) / 100),
                top: Math.floor((percentY * (imgH - sh)) / 100),
                width: sw,
                height: sh,
            });
        }

        const resized = await pipeline
            .resize(128 * mapSize_x, 128 * mapSize_y, { fit: "fill" })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        let data = resized.data;
        const info = resized.info;

        const pre = settings.preprocessing;
        if (pre && pre.enabled) {
            const brightness = (pre.brightness ?? 100) / 100;
            const contrast = (pre.contrast ?? 100) / 100;
            const saturation = (pre.saturation ?? 100) / 100;

            data = await sharp(data, {
                raw: { width: info.width, height: info.height, channels: 4 },
            })
                .modulate({ brightness, saturation })
                .linear(
                    [contrast, contrast, contrast, 1],
                    [
                        128 * (1 - contrast),
                        128 * (1 - contrast),
                        128 * (1 - contrast),
                        0,
                    ],
                )
                .raw()
                .toBuffer();
        }

        let result;
        if (ditherName === "None") {
            result = quantize(data, palette, betterColour);
        } else if (ditherMethod.ditherDivisor !== undefined) {
            result = quantizeErrorDiffusion(
                data,
                info.width,
                info.height,
                palette,
                betterColour,
                ditherMethod,
            );
        } else {
            result = quantizeOrdered(
                data,
                info.width,
                info.height,
                palette,
                betterColour,
                ditherMethod,
            );
        }
        const { pixels, layout } = result;

        const png = await sharp(pixels, {
            raw: { width: info.width, height: info.height, channels: 4 },
        })
            .png()
            .toBuffer();

        const { maps, materials } = countMaterials(
            layout,
            info.width,
            info.height,
            selectedBlocks,
        );

        const previewId = crypto.randomUUID();
        if (previews.size >= MAX_PREVIEWS) {
            previews.delete(previews.keys().next().value);
        }
        previews.set(previewId, {
            png,
            layout,
            maps,
            selectedBlocks,
            settings,
            width: info.width,
            height: info.height,
            createdAt: Date.now(),
        });

        res.json({
            previewId,
            width: info.width,
            height: info.height,
            imageUrl: `/previews/${previewId}/image`,
            materials,
        });
    } catch (e) {
        console.error(e);
        res.status(400).json({ error: "Не удалось обработать картинку" });
    }
});

app.get("/previews/:id/image", async (req, res) => {
    const preview = previews.get(req.params.id);
    if (!preview) {
        return res.status(404).json({ error: "Превью не найдено" });
    }

    const scale = Math.min(Math.max(parseInt(req.query.scale) || 1, 1), 16);

    try {
        const out =
            scale === 1
                ? preview.png
                : await sharp(preview.png)
                      .resize(preview.width * scale, preview.height * scale, {
                          kernel: sharp.kernel.nearest,
                      })
                      .png()
                      .toBuffer();
        res.type("image/png").send(out);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Не удалось увеличить превью" });
    }
});

app.post("/previews/:id/nbt", (req, res) => {
    const preview = previews.get(req.params.id);
    if (!preview) {
        return res.status(404).json({ error: "Превью не найдено" });
    }

    const { settings } = preview;
    if (settings.staircasing !== false) {
        return res.status(400).json({
            error: 'Пока поддерживаются только плоские карты: поставь "staircasing": false в settings',
        });
    }

    try {
        const nbt = buildSchematic({
            layout: preview.layout,
            width: preview.width,
            height: preview.height,
            selectedBlocks: preview.selectedBlocks,
            mcVersion: settings.version || "1.20",
            supportBlock: (
                settings.supportBlock || "cobblestone"
            ).toLowerCase(),
        });

        res.set("Content-Disposition", 'attachment; filename="mapart.nbt"');
        res.type("application/octet-stream").send(zlib.gzipSync(nbt));
    } catch (e) {
        console.error(e);
        res.status(400).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`MapartCraft API listening on port ${PORT}`);
});
