const coloursJSON = require("../../src/components/mapart/json/coloursJSON.json");
const supportedVersions = require("../../src/components/mapart/json/supportedVersions.json");
const { TagTypes, NBTWriter } = require("./nbtWriter");

function getBlockNBTData(colourSetId, blockId, mcVersion) {
    const block = coloursJSON[colourSetId].blocks[blockId];
    let data = block.validVersions[mcVersion];
    if (data === undefined) {
        throw new Error(
            `Блок "${block.displayName}" недоступен в версии ${mcVersion}`,
        );
    }
    if (typeof data === "string") {
        data = block.validVersions[data.slice(1)];
    }
    return data;
}

function makePaletteItem(name, args) {
    const item = {
        Name: { type: TagTypes.string, value: `minecraft:${name}` },
    };
    if (args && Object.keys(args).length !== 0) {
        item.Properties = { type: TagTypes.compound, value: {} };
        for (const [key, value] of Object.entries(args)) {
            item.Properties.value[key] = { type: TagTypes.string, value };
        }
    }
    return item;
}

function makeBlock(x, y, z, state) {
    return {
        pos: {
            type: TagTypes.list,
            value: { type: TagTypes.int, value: [x, y, z] },
        },
        state: { type: TagTypes.int, value: state },
    };
}

function buildSchematic({
    layout,
    width,
    height,
    selectedBlocks,
    mcVersion,
    supportBlock,
}) {
    const versionInfo = Object.values(supportedVersions).find(
        (v) => v.MCVersion === mcVersion,
    );
    if (!versionInfo) {
        throw new Error(`Неизвестная версия: ${mcVersion}`);
    }

    const paletteIndex = {};
    const palette = [];
    for (const { colourSetId } of layout) {
        if (colourSetId in paletteIndex) continue;
        const data = getBlockNBTData(
            colourSetId,
            selectedBlocks[colourSetId],
            mcVersion,
        );
        paletteIndex[colourSetId] = palette.length;
        palette.push(makePaletteItem(data.NBTName, data.NBTArgs));
    }
    const nooblineIndex = palette.length;
    palette.push(makePaletteItem(supportBlock, {}));

    const Y = 2;
    const blocks = [];
    for (let x = 0; x < width; x++) {
        blocks.push(makeBlock(x, Y, 0, nooblineIndex));
        for (let row = 0; row < height; row++) {
            const { colourSetId } = layout[row * width + x];
            blocks.push(makeBlock(x, Y, row + 1, paletteIndex[colourSetId]));
        }
    }

    const nbt = {
        name: "",
        value: {
            blocks: {
                type: TagTypes.list,
                value: { type: TagTypes.compound, value: blocks },
            },
            entities: {
                type: TagTypes.list,
                value: { type: TagTypes.compound, value: [] },
            },
            palette: {
                type: TagTypes.list,
                value: { type: TagTypes.compound, value: palette },
            },
            size: {
                type: TagTypes.list,
                value: {
                    type: TagTypes.int,
                    value: [width, Y + 1, height + 1],
                },
            },
            author: { type: TagTypes.string, value: "mapartcraft-api" },
            DataVersion: { type: TagTypes.int, value: versionInfo.NBTVersion },
        },
    };

    const writer = new NBTWriter();
    writer.writeTopLevelCompound(nbt);
    return Buffer.from(writer.getData());
}

module.exports = { buildSchematic };
