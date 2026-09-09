export type LocationReading = {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
};

export const HIGH_ACCURACY_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 20_000,
};

const normalize = (position: GeolocationPosition): LocationReading | null => {
  const { latitude: lat, longitude: lng, accuracy } = position.coords;
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Number.isFinite(accuracy) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180 ||
    (lat === 0 && lng === 0)
  ) {
    return null;
  }
  return {
    lat,
    lng,
    accuracy: Math.max(accuracy, 1),
    timestamp: position.timestamp || Date.now(),
  };
};

export const locationErrorMessage = (error: GeolocationPositionError) => {
  if (error.code === error.PERMISSION_DENIED)
    return "Location permission is blocked. Allow location for this site, then retry.";
  if (error.code === error.POSITION_UNAVAILABLE)
    return "Your device could not determine a location. Check GPS, Wi-Fi, or system location services.";
  if (error.code === error.TIMEOUT)
    return "Location lookup timed out. Move near a window or retry with GPS enabled.";
  return "Your device could not determine a valid location. Retry the GPS lookup.";
};

export const readCurrentLocation = (): Promise<LocationReading> => {
  if (!navigator.geolocation)
    return Promise.reject(new Error("This browser does not support location."));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const reading = normalize(position);
        if (reading) resolve(reading);
        else reject(new Error("Your device returned invalid coordinates."));
      },
      (error) => reject(new Error(locationErrorMessage(error))),
      HIGH_ACCURACY_OPTIONS,
    );
  });
};

export const watchLocation = (
  onLocation: (reading: LocationReading) => void,
  onError: (message: string) => void,
) => {
  if (!navigator.geolocation) {
    onError("This browser does not support location.");
    return null;
  }
  return navigator.geolocation.watchPosition(
    (position) => {
      const reading = normalize(position);
      if (reading) onLocation(reading);
      else onError("Your device returned invalid coordinates.");
    },
    (error) => onError(locationErrorMessage(error)),
    HIGH_ACCURACY_OPTIONS,
  );
};
