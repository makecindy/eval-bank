export function createMessageProjectionCache() {
    const snapshots = new WeakMap();
    return (snapshot, dependencies, compute) => {
        const previous = snapshots.get(snapshot);
        if (previous &&
            previous.dependencies.length === dependencies.length &&
            dependencies.every((value, index) => Object.is(value, previous.dependencies[index]))) {
            return previous.value;
        }
        const value = compute();
        snapshots.set(snapshot, { dependencies: [...dependencies], value });
        return value;
    };
}
