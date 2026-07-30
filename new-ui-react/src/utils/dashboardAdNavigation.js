/**
 * Resolve modal navigation from the exact dashboard position captured when a
 * card was rendered. Ad IDs are not used because creative variants may share
 * the same ID within one result set.
 */
export const getDashboardAdNavigation = (
  items = [],
  selectedAd = null,
  visualOrder = [],
) => {
  const requestedIndex = selectedAd?._dashboardIndex;
  const index =
    Number.isInteger(requestedIndex) &&
    requestedIndex >= 0 &&
    requestedIndex < items.length
      ? requestedIndex
      : -1;
  const order =
    visualOrder.length > 0
      ? visualOrder.filter(
          (dashboardIndex) =>
            Number.isInteger(dashboardIndex) &&
            dashboardIndex >= 0 &&
            dashboardIndex < items.length,
        )
      : items.map((_, dashboardIndex) => dashboardIndex);
  const visualIndex = order.indexOf(index);

  return {
    index,
    visualIndex,
    previous:
      visualIndex > 0 ? items[order[visualIndex - 1]] : null,
    next:
      visualIndex >= 0 && visualIndex < order.length - 1
        ? items[order[visualIndex + 1]]
        : null,
  };
};
