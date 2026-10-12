// A keyword or advertiser list from AI Search is stored beside the search query
// so the request can send it as an array. It applies only while the search bar
// still shows the query and search type the list was created for.
export const resolveSearchTerms = (searchList, searchQuery, searchIn) =>
  searchList && searchList.query === searchQuery && searchList.searchIn === searchIn
    ? searchList.terms
    : null;
