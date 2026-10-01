export let current = {
    dataOwnerId: null,
    generation: 0,
};
export function setDataOwnerGeneration(dataOwnerId, generation) {
    const nextGeneration = typeof generation === 'number' && Number.isInteger(generation) && generation >= 0
        ? generation
        : current.generation + 1;
    if (current.dataOwnerId === dataOwnerId && current.generation === nextGeneration)
        return;
    Object.assign(current, { dataOwnerId, generation: nextGeneration });
}
export function getDataOwnerGeneration() {
    return current;
}
