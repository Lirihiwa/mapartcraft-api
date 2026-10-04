const { NBTWriter, TagTypes } = require("../src/nbtWriter");

const writer = new NBTWriter();
writer.writeTopLevelCompound({
    name: "",
    value: { author: { type: TagTypes.string, value: "test" } },
});
const buf = Buffer.from(writer.getData());
console.log(buf.length, buf);
