export const fixBlankFiles = (ctx) => {
    const { contents } = ctx;
    const _contents = contents.trim().length === 0
        ? `
export {}
export default undefined
` : contents;
    return Object.assign(Object.assign({}, ctx), { contents: _contents });
};
