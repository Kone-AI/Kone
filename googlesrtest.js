import {
  search,
  OrganicResult,
  DictionaryResult,
} from "google-sr";

const queryResult = await search({
  query: "news today",
  // Specify the result types explicitly ([OrganicResult] is the default, but it is recommended to always specify the result type)
  resultTypes: [OrganicResult, DictionaryResult],
});

// will return a SearchResult[]
console.log(queryResult);