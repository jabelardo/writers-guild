export const IMAGE_MIME_TYPES_MAP = {
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const mimeTypeFromExt = (ext) => {
    if (!ext || ext.lenght == 0) return null;
    const finalExt = ext[0] == '.' ? ext.slice(1): ext;
    for (const [key, value] of Object.entries(IMAGE_MIME_TYPES_MAP)) {
        if (value == finalExt) {
            return key;
        }
    }
    return null;
}

export const mimeTypeToExt = (mime) => IMAGE_MIME_TYPES_MAP[mime] || 'bin';
