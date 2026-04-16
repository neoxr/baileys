export const fixDefaultExport = (ctx) => {
    const { contents } = ctx;
    const _contents = contents.includes('export default')
        ? contents
        : `${contents}
export default undefined
`;
    return Object.assign(Object.assign({}, ctx), { contents: _contents });
};
