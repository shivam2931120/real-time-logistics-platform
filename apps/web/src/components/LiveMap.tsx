import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair, LocateFixed, Maximize2 } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Driver, Order } from '@routepulse/shared';

type Props = {
  drivers: Driver[];
  orders: Order[];
  selectedOrderId?: string;
  selectedDriverId?: string;
  routeCoordinates?: Array<{ lat: number; lng: number }>;
  onOrderSelect?: (order: Order) => void;
  onDriverSelect?: (driver: Driver) => void;
};

const activeOrder = (order: Order) => !['delivered', 'cancelled', 'failed'].includes(order.status);

export function LiveMap({ drivers, orders, selectedOrderId, selectedDriverId, routeCoordinates, onOrderSelect, onDriverSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const fittedRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [locationState, setLocationState] = useState<'idle' | 'locating' | 'denied'>('idle');

  const fitOperations = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const coordinates = [
      ...drivers.map(driver => [driver.location.lng, driver.location.lat] as [number, number]),
      ...orders.filter(activeOrder).flatMap(order => [[order.pickup.lng, order.pickup.lat], [order.dropoff.lng, order.dropoff.lat]] as [number, number][]),
      ...(routeCoordinates ?? []).map(point => [point.lng, point.lat] as [number, number]),
    ];
    if (!coordinates.length) return map.easeTo({ center: [77.606, 12.961], zoom: 11.5 });
    const bounds = coordinates.reduce((value, point) => value.extend(point), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
    map.fitBounds(bounds, { padding: 70, maxZoom: 14, duration: 700 });
  }, [drivers, orders, routeCoordinates]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: import.meta.env.VITE_MAP_STYLE || 'https://demotiles.maplibre.org/style.json', center: [77.606, 12.961], zoom: 11.5, attributionControl: false });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.on('load', () => {
      map.addSource('delivery-routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'delivery-routes', type: 'line', source: 'delivery-routes', paint: { 'line-color': ['case', ['boolean', ['get', 'selected'], false], '#9fca19', '#294438'], 'line-width': ['case', ['boolean', ['get', 'selected'], false], 5, 2.5], 'line-opacity': .78, 'line-dasharray': [2, 1.5] } });
      setLoaded(true);
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    mapRef.current = map;
    return () => { observer.disconnect(); markersRef.current.forEach(marker => marker.remove()); userMarkerRef.current?.remove(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    for (const driver of drivers) {
      const element = document.createElement('button');
      element.type = 'button'; element.className = `map-marker ${driver.status}${selectedDriverId === driver.id ? ' selected' : ''}`; element.title = `${driver.name} · ${driver.status}`; element.setAttribute('aria-label', element.title);
      element.addEventListener('click', event => { event.stopPropagation(); onDriverSelect?.(driver); });
      const popup = document.createElement('div'); const title = document.createElement('strong'); title.textContent = driver.name; const detail = document.createElement('span'); detail.textContent = `${driver.status} · ${driver.capacityKg} kg capacity`; popup.className = 'map-popup'; popup.append(title, detail);
      markersRef.current.push(new maplibregl.Marker({ element }).setLngLat([driver.location.lng, driver.location.lat]).setPopup(new maplibregl.Popup({ offset: 18 }).setDOMContent(popup)).addTo(map));
    }
    for (const order of orders.filter(activeOrder)) {
      const pickup = document.createElement('button'); pickup.type = 'button'; pickup.className = `pickup-marker${selectedOrderId === order.id ? ' selected' : ''}`; pickup.textContent = 'A'; pickup.title = `Pickup · ${order.pickup.label}`; pickup.addEventListener('click', event => { event.stopPropagation(); onOrderSelect?.(order); });
      markersRef.current.push(new maplibregl.Marker({ element: pickup }).setLngLat([order.pickup.lng, order.pickup.lat]).addTo(map));
      const stop = document.createElement('button'); stop.type = 'button'; stop.className = `stop-marker ${order.priority}${selectedOrderId === order.id ? ' selected' : ''}`; stop.textContent = order.priority === 'urgent' ? '!' : 'B'; stop.title = `${order.trackingCode} · ${order.dropoff.label}`; stop.addEventListener('click', event => { event.stopPropagation(); onOrderSelect?.(order); });
      const popup = document.createElement('div'); const title = document.createElement('strong'); title.textContent = order.trackingCode; const detail = document.createElement('span'); detail.textContent = `${order.customerName} · ${order.dropoff.label}`; popup.className = 'map-popup'; popup.append(title, detail);
      markersRef.current.push(new maplibregl.Marker({ element: stop }).setLngLat([order.dropoff.lng, order.dropoff.lat]).setPopup(new maplibregl.Popup({ offset: 18 }).setDOMContent(popup)).addTo(map));
    }
    const source = map.getSource('delivery-routes') as maplibregl.GeoJSONSource;
    const orderRoutes = orders.filter(activeOrder).map(order => ({ type: 'Feature' as const, properties: { id: order.id, selected: order.id === selectedOrderId }, geometry: { type: 'LineString' as const, coordinates: [[order.pickup.lng, order.pickup.lat], [order.dropoff.lng, order.dropoff.lat]] } }));
    const optimizedRoute = routeCoordinates && routeCoordinates.length > 1 ? [{ type: 'Feature' as const, properties: { id: 'optimized-route', selected: true }, geometry: { type: 'LineString' as const, coordinates: routeCoordinates.map(point => [point.lng, point.lat]) } }] : [];
    source.setData({ type: 'FeatureCollection', features: [...orderRoutes, ...optimizedRoute] });
    if (!fittedRef.current && (drivers.length || orders.length)) { fittedRef.current = true; fitOperations(); }
  }, [drivers, fitOperations, loaded, onDriverSelect, onOrderSelect, orders, routeCoordinates, selectedDriverId, selectedOrderId]);

  const locate = () => {
    if (!navigator.geolocation) return setLocationState('denied');
    setLocationState('locating');
    navigator.geolocation.getCurrentPosition(position => {
      const map = mapRef.current; if (!map) return;
      const point: [number, number] = [position.coords.longitude, position.coords.latitude];
      if (!userMarkerRef.current) { const element = document.createElement('div'); element.className = 'user-location-marker'; userMarkerRef.current = new maplibregl.Marker({ element }).setLngLat(point).addTo(map); } else userMarkerRef.current.setLngLat(point);
      map.flyTo({ center: point, zoom: 14.5 }); setLocationState('idle');
    }, () => setLocationState('denied'), { enableHighAccuracy: true, timeout: 10_000 });
  };

  return <div className="map-stage"><div ref={containerRef} className="live-map" aria-label="Live fleet and delivery map"/><div className="map-tools" aria-label="Map controls"><button type="button" onClick={fitOperations} title="Fit all operations"><Maximize2/>Fit all</button><button type="button" onClick={locate} title="Show my location"><LocateFixed/>{locationState === 'locating' ? 'Locating…' : 'My location'}</button></div>{!loaded&&<div className="map-loading"><Crosshair/>Loading map…</div>}{locationState==='denied'&&<div className="map-notice">Location access is unavailable. Enable it in your browser and retry.</div>}</div>;
}
