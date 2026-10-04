/*
  A mapping from type names to NBT type numbers.
  This is NOT just an enum, these values have to stay as they are
  https://minecraft.wiki/w/NBT_format#TAG_definition
*/
const TagTypes = {
    end: 0,
    byte: 1,
    short: 2,
    int: 3,
    long: 4,
    float: 5,
    double: 6,
    byteArray: 7,
    string: 8,
    list: 9,
    compound: 10,
    intArray: 11,
    longArray: 12,
};

class NBTWriter {
    constructor() {
        if (typeof ArrayBuffer === "undefined") {
            throw new Error("Missing required type ArrayBuffer");
        }
        if (typeof DataView === "undefined") {
            throw new Error("Missing required type DataView");
        }
        if (typeof Uint8Array === "undefined") {
            throw new Error("Missing required type Uint8Array");
        }
        /* Will be auto-resized (x2) on write if necessary. */
        this.buffer = new ArrayBuffer(1024);

        /* These are recreated when the buffer is */
        this.dataView = new DataView(this.buffer);
        this.arrayView = new Uint8Array(this.buffer);
        this.offset = 0;
    }

    encodeUTF8(str) {
        let array = [],
            i,
            c;
        for (i = 0; i < str.length; i++) {
            c = str.charCodeAt(i);
            if (c === 0x0) {
                array.push(0xc0);
                array.push(0x80);
            } else if (c < 0x80) {
                array.push(c);
            } else if (c < 0x800) {
                array.push(0xc0 | (c >> 6));
                array.push(0x80 | (c & 0x3f));
            } else if (c < 0x10000) {
                array.push(0xe0 | (c >> 12));
                array.push(0x80 | ((c >> 6) & 0x3f));
                array.push(0x80 | (c & 0x3f));
            } else {
                // unsure if this is accurate, however we never need such exotic unicode characters
                array.push(0xf0 | ((c >> 18) & 0x07));
                array.push(0x80 | ((c >> 12) & 0x3f));
                array.push(0x80 | ((c >> 6) & 0x3f));
                array.push(0x80 | (c & 0x3f));
            }
        }
        return array;
    }

    accommodate(size) {
        // Ensures that the buffer is large enough to write `size` bytes at the current `this.offset`.
        let requiredLength = this.offset + size;
        if (this.buffer.byteLength >= requiredLength) {
            return;
        }

        let newLength = this.buffer.byteLength;
        while (newLength < requiredLength) {
            newLength *= 2;
        }
        let newBuffer = new ArrayBuffer(newLength);
        let newArrayView = new Uint8Array(newBuffer);
        newArrayView.set(this.arrayView);

        // If there's a gap between the end of the old buffer
        // and the start of the new one, we need to zero it out
        if (this.offset > this.buffer.byteLength) {
            newArrayView.fill(0, this.buffer.byteLength, this.offset);
        }

        this.buffer = newBuffer;
        this.dataView = new DataView(newBuffer);
        this.arrayView = newArrayView;
    }

    write(dataType, size, value) {
        this.accommodate(size);
        this.dataView[`set${dataType}`](this.offset, value);
        this.offset += size;
    }

    writeByType(dataType, value) {
        switch (dataType) {
            case TagTypes.end: {
                this.writeByType(TagTypes.byte, 0);
                break;
            }
            case TagTypes.byte: {
                this.write("Int8", 1, value);
                break;
            }
            case TagTypes.short: {
                this.write("Int16", 2, value);
                break;
            }
            case TagTypes.int: {
                this.write("Int32", 4, value);
                break;
            }
            case TagTypes.long: {
                // NB: special: JS doesn't support native 64 bit ints; pass an array of two 32 bit ints to this case
                this.write("Int32", 4, value[0]);
                this.write("Int32", 4, value[1]);
                break;
            }
            case TagTypes.float: {
                this.write("Float32", 4, value);
                break;
            }
            case TagTypes.double: {
                this.write("Float64", 8, value);
                break;
            }
            case TagTypes.byteArray: {
                this.writeByType(TagTypes.int, value.length);
                this.accommodate(value.length);
                this.arrayView.set(value, this.offset);
                this.offset += value.length;
                break;
            }
            case TagTypes.string: {
                let bytes = this.encodeUTF8(value);
                this.writeByType(TagTypes.short, bytes.length);
                this.accommodate(bytes.length);
                this.arrayView.set(bytes, this.offset);
                this.offset += bytes.length;
                break;
            }
            case TagTypes.list: {
                // Pass a dicitonary {"type": TagTypes.blah, "value": [] }
                this.writeByType(TagTypes.byte, value.type);
                this.writeByType(TagTypes.int, value.value.length);
                for (let i = 0; i < value.value.length; i++) {
                    this.writeByType(value.type, value.value[i]);
                }
                break;
            }
            case TagTypes.compound: {
                // This is the rich tagtype we will interact with a lot
                // Pass a dictionary {"type": TagTypes.blah, "value": ... }
                // {
                //   author: { type: TagTypes.string, value: "Steve" },
                //   stuff: {
                //       type: TagTypes.compound,
                //       value: {
                //         foo: { type: int, value: 42 },
                //         bar: { type: string, value: 'Hi!' }
                //       }
                //   }
                // }
                Object.keys(value).forEach((key) => {
                    this.writeByType(TagTypes.byte, value[key].type);
                    this.writeByType(TagTypes.string, key);
                    this.writeByType(value[key].type, value[key].value); // this is where the nice recursion happens
                });
                this.writeByType(TagTypes.end, 0);
                break;
            }
            case TagTypes.intArray: {
                this.writeByType(TagTypes.int, value.length);
                for (let i = 0; i < value.length; i++) {
                    this.writeByType(TagTypes.int, value[i]);
                    // https://lkml.org/lkml/2012/7/6/495
                }
                break;
            }
            case TagTypes.longArray: {
                this.writeByType(TagTypes.int, value.length);
                for (let i = 0; i < value.length; i++) {
                    this.writeByType(TagTypes.long, value[i]);
                    // NB this is an array of longs given as specified in case:long
                }
                break;
            }
            case "UBYTE": {
                // unsure why this is here, seems unused; nbt raw bytes (TagTypes.byte) are signed
                this.write("Uint8", 1, value);
                break;
            }
            default: {
                throw new Error(
                    `Unknown data type ${dataType} for value ${value}`,
                );
            }
        }
    }

    writeTopLevelCompound(value) {
        // For writing a top level JSON object as a compound tag.
        // This is of the form {"name": "blah", "value": {...}}
        // This is not just this.writeByType(TagTypes.compound, value); we add the appropriate compound prefix etc
        this.writeByType(TagTypes.byte, TagTypes.compound);
        this.writeByType(TagTypes.string, value.name);
        this.writeByType(TagTypes.compound, value.value);
    }

    getData() {
        /*
      Returns the writen data as a slice from the internal buffer, cutting off any padding at the end.
    */
        this.accommodate(0); /* make sure the offset is inside the buffer */
        return this.buffer.slice(0, this.offset);
    }
}

module.exports = { TagTypes, NBTWriter };
