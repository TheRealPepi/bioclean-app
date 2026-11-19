// Address search for the office, on Google's Places autocomplete. What the
// office types is sent to Google.
import { loadGoogleMaps } from "./googleMaps";

type Point = { lat: number; lng: number };

/** A suggestion shown while typing. Its location is only known after `resolvePlace`. */
export type Place = {
  id: string;
  /** "Calle 15 Sur 624", "MEGA Soriana Isla de Cozumel". */
  name: string;
  /** Colonia, town and state, to tell apart places with the same name. */
  detail: string;
  prediction: google.maps.places.PlacePrediction;
};

// Only the island, so "Calle 10 Norte" isn't the one in Playa del Carmen.
const COZUMEL = { west: -87.06, south: 20.25, east: -86.7, north: 20.62 };

export const MIN_SEARCH_LENGTH = 3;

// Google bills the keystrokes of one search plus the lookup of the chosen
// place as a single session, as long as they share this token.
let session: google.maps.places.AutocompleteSessionToken | null = null;

/** Addresses and places in Cozumel matching what was typed. Throws if Google can't be reached. */
export async function searchPlaces(query: string): Promise<Place[]> {
  await loadGoogleMaps();
  const { AutocompleteSuggestion, AutocompleteSessionToken } = (await google.maps.importLibrary(
    "places",
  )) as google.maps.PlacesLibrary;
  session ??= new AutocompleteSessionToken();
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input: query,
    sessionToken: session,
    locationRestriction: COZUMEL,
    language: "es",
    region: "mx",
  });
  return suggestions.flatMap(({ placePrediction: prediction }) =>
    prediction
      ? [
          {
            id: prediction.placeId,
            name: prediction.mainText?.text ?? prediction.text.text,
            detail: prediction.secondaryText?.text ?? "",
            prediction,
          },
        ]
      : [],
  );
}

/** Where a chosen suggestion is. This lookup ends the billing session. */
export async function resolvePlace(place: Place): Promise<Point> {
  session = null;
  const details = place.prediction.toPlace();
  await details.fetchFields({ fields: ["location"] });
  if (!details.location) throw new Error("Google returned no location for the place");
  return { lat: details.location.lat(), lng: details.location.lng() };
}
