const { buildSchematic } = require("../src/schematic");

const white = { colourSetId: "13", tone: "normal" };
const black = { colourSetId: "28", tone: "normal" };

const buf = buildSchematic({
    layout: [white, black, black, white],
    width: 2,
    height: 2,
    selectedBlocks: { 13: "0", 28: "0" },
    mcVersion: "1.20",
    supportBlock: "cobblestone",
});
console.log(buf.length, buf.subarray(0, 12));
