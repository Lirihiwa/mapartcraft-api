const coloursJSON = require("../../src/components/mapart/json/coloursJSON.json");

function countMaterials(layout, width, height, selectedBlocks) {
    const mapsX = width / 128;
    const mapsY = height / 128;

    const maps = [];
    for (let y = 0; y < mapsY; y++) {
        const row = [];
        for (let x = 0; x < mapsX; x++) {
            row.push({});
        }
        maps.push(row);
    }

    const total = {};
    for (let i = 0; i < layout.length; i++) {
        const px = i % width;
        const py = Math.floor(i / width);
        const { colourSetId } = layout[i];
        const mapMaterials = maps[Math.floor(py / 128)][Math.floor(px / 128)];
        mapMaterials[colourSetId] = (mapMaterials[colourSetId] || 0) + 1;
        total[colourSetId] = (total[colourSetId] || 0) + 1;
    }

    const materials = Object.entries(total)
        .map(([colourSetId, count]) => {
            const blockId = selectedBlocks[colourSetId];
            return {
                colourSetId,
                blockId,
                displayName:
                    coloursJSON[colourSetId].blocks[blockId].displayName,
                count,
            };
        })
        .sort((a, b) => b.count - a.count);

    return { maps, materials };
}

module.exports = { countMaterials };
