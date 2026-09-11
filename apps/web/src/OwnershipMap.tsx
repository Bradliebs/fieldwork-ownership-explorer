import { useEffect, useRef, useState } from 'react';
import { Map as MapInstance, ScaleControl, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection } from 'geojson';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { parcelBounds, parcelStatus, type Parcel } from '../../../packages/contracts/src/ownership.ts';

setWorkerUrl(workerUrl);

const initialBounds: [[number, number], [number, number]] = [[-2.610, 51.447], [-2.588, 51.456]];
const baseLayers = ['parks', 'water', 'buildings', 'road-casing', 'roads', 'road-labels'];
const parcelLayers = ['parcel-fill', 'parcel-edge', 'candidate-edge', 'selected-fill', 'selected-halo', 'selected'];
function mapStyle(pilot: boolean): StyleSpecification {
  return { version: 8, sources: pilot ? { context: { type: 'geojson', data: '/api/pilot-basemap' } } : {}, layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f1f3f0' } },
    ...(pilot ? [
      { id: 'parks', type: 'fill', source: 'context', filter: ['==', ['get', 'kind'], 'park'], paint: { 'fill-color': '#dce8d4' } },
      { id: 'water', type: 'fill', source: 'context', filter: ['==', ['get', 'kind'], 'water'], paint: { 'fill-color': '#b8dce4' } },
      { id: 'buildings', type: 'fill', source: 'context', filter: ['==', ['get', 'kind'], 'building'], paint: { 'fill-color': '#d2d5d2', 'fill-outline-color': '#b9bfbb' } },
      { id: 'road-casing', type: 'line', source: 'context', filter: ['==', ['get', 'kind'], 'road'], paint: { 'line-color': '#d3d7d2', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 18, 13] } },
      { id: 'roads', type: 'line', source: 'context', filter: ['==', ['get', 'kind'], 'road'], paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 18, 10] } },
      { id: 'road-labels', type: 'symbol', source: 'context', minzoom: 14, filter: ['==', ['get', 'kind'], 'road'], layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['IBM Plex Sans'], 'text-size': 11, 'symbol-spacing': 250 }, paint: { 'text-color': '#56645f', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } },
    ] as StyleSpecification['layers'] : []),
  ] };
}
function featureData(parcels: Parcel[]): FeatureCollection {
  return { type: 'FeatureCollection', features: parcels.map(parcel => ({ type: 'Feature', id: parcel.id,
    properties: { id: parcel.id, status: parcelStatus(parcel) }, geometry: parcel.geometry,
  })) };
}

export function OwnershipMap({ parcels, allParcels, pilot, selected, onSelect, snapshot = false }: { parcels: Parcel[]; allParcels: Parcel[]; pilot: boolean; selected: string | null; onSelect: (id: string) => void; snapshot?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapInstance | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [showBasemap, setShowBasemap] = useState(true);
  const [showParcels, setShowParcels] = useState(true);
  const fitted = useRef(false);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (!container.current) return;
    let instance: MapInstance;
    try {
      instance = new MapInstance({ container: container.current, bounds: initialBounds, fitBoundsOptions: { padding: 50 },
        attributionControl: false,
        style: mapStyle(pilot),
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Map unavailable'); return; }
    map.current = instance;
    instance.addControl(new ScaleControl({ unit: 'metric', maxWidth: 100 }), 'bottom-left');
    instance.on('error', event => setError(event.error.message));
    instance.on('load', () => {
      instance.addSource('parcels', { type: 'geojson', data: featureData([]), promoteId: 'id' });
      instance.addLayer({ id: 'parcel-fill', type: 'fill', source: 'parcels', paint: {
        'fill-color': ['match', ['get', 'status'], 'verified', '#46997d', 'candidate', '#dbaa62', 'ambiguous', '#b77376', '#bcc6c1'],
        'fill-opacity': pilot ? 0.06 : 0.55,
      } });
      instance.addLayer({ id: 'parcel-edge', type: 'line', source: 'parcels', filter: ['!=', ['get', 'status'], 'candidate'], paint: {
        'line-color': ['match', ['get', 'status'], 'verified', '#28775c', 'ambiguous', '#985052', '#627d89'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 17, 1.5],
      } });
      instance.addLayer({ id: 'candidate-edge', type: 'line', source: 'parcels', filter: ['==', ['get', 'status'], 'candidate'], paint: { 'line-color': '#ab762c', 'line-width': 1.5, 'line-dasharray': [3, 2] } });
      instance.addLayer({ id: 'selected-fill', type: 'fill', source: 'parcels', filter: ['==', ['get', 'id'], ''], paint: { 'fill-color': '#0097bc', 'fill-opacity': 0.23 } });
      instance.addLayer({ id: 'selected-halo', type: 'line', source: 'parcels', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#ffffff', 'line-width': 5 } });
      instance.addLayer({ id: 'selected', type: 'line', source: 'parcels', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#007c9d', 'line-width': 3 } });
      instance.on('click', 'parcel-fill', event => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === 'string') onSelectRef.current(id);
      });
      instance.on('mouseenter', 'parcel-fill', () => { instance.getCanvas().style.cursor = 'pointer'; });
      instance.on('mouseleave', 'parcel-fill', () => { instance.getCanvas().style.cursor = ''; });
      setReady(true);
    });
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (ready) (map.current?.getSource('parcels') as GeoJSONSource | undefined)?.setData(featureData(parcels));
  }, [parcels, ready]);
  useEffect(() => {
    if (!ready) return;
    for (const layer of ['selected', 'selected-halo', 'selected-fill']) map.current?.setFilter(layer, ['==', ['get', 'id'], selected ?? '']);
    const parcel = allParcels.find(item => item.id === selected);
    const extent = snapshot ? parcelBounds(allParcels) : parcel && parcelBounds([parcel]);
    if (extent) map.current?.fitBounds(extent, { padding: 75, maxZoom: 18, duration: 400 });
  }, [selected, ready, allParcels, snapshot]);
  useEffect(() => {
    if (!ready || fitted.current) return;
    const extent = parcelBounds(allParcels);
    if (extent) { map.current?.fitBounds(pilot ? initialBounds : extent, { padding: 45, duration: 0 }); fitted.current = true; }
  }, [allParcels, pilot, ready]);
  useEffect(() => {
    if (!ready) return;
    for (const layer of baseLayers) if (map.current?.getLayer(layer)) map.current.setLayoutProperty(layer, 'visibility', showBasemap ? 'visible' : 'none');
    for (const layer of parcelLayers) map.current?.setLayoutProperty(layer, 'visibility', showParcels ? 'visible' : 'none');
  }, [showBasemap, showParcels, ready]);
  return <section className={`map-area ${pilot ? 'pilot-map' : ''}`} aria-label={snapshot ? 'Saved parcel map' : pilot ? 'Bristol parcel map' : 'Synthetic parcel map'}>
    <div className="map-canvas" ref={container} data-testid="map" data-ready={ready} />
    <div className="map-caption"><span className="live-dot" /> {snapshot ? (allParcels.length > 1 ? 'SAVED SITE' : 'SAVED PARCEL') : pilot ? 'BRISTOL HARBOURSIDE' : 'FIXTURE AREA'} <span>{allParcels.length} {pilot || snapshot ? 'INSPIRE polygons' : 'fictional parcels'}</span></div>
    {pilot && <div className="map-layers"><label><input type="checkbox" checked={showBasemap} onChange={event => setShowBasemap(event.target.checked)} />Basemap</label><label><input type="checkbox" checked={showParcels} onChange={event => setShowParcels(event.target.checked)} />Parcels</label></div>}
    <div className="map-tools">
      <button title="Zoom in" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}><Plus size={18} /></button>
      <button title="Zoom out" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}><Minus size={18} /></button>
      <button title="Fit all parcels" aria-label="Fit all parcels" onClick={() => { const extent = parcelBounds(allParcels); if (extent) map.current?.fitBounds(extent, { padding: 50 }); }}><Maximize2 size={17} /></button>
    </div>
    <div className="map-legend">{pilot || snapshot ? <><span><i className="boundary-key" />Indicative freehold</span><span><i className="selection-key" />Selected</span></> : ['verified', 'candidate', 'ambiguous', 'unknown'].map(status => <span key={status}><i className={status} />{status}</span>)}</div>
    <div className="map-attribution">{pilot ? <><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">(c) OpenStreetMap contributors / ODbL</a><span> | </span><a href="https://use-land-property-data.service.gov.uk/datasets/inspire/#conditions" target="_blank" rel="noreferrer">HMLR &amp; OS (c) Crown copyright and database rights 2026 / OS AC0000851063</a><span> | </span><a href="/api/pilot-release" target="_blank" rel="noreferrer">Full attribution</a></> : snapshot ? 'HMLR / OS. Full source attribution below. Indicative extent only.' : 'Synthetic geometry. No legal boundaries or real ownership.'}</div>
    {error && <div className="map-error" role="alert" tabIndex={-1} ref={errorRef}>Map data error: {error}. Parcel records remain available in the list.</div>}
  </section>;
}