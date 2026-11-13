import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './main.css';

// 1. Read environment variables securely using Vite's import.meta.env system
const region = import.meta.env.VITE_AWS_REGION;
const mapName = import.meta.env.VITE_AWS_MAP_NAME;
const placeIndex = import.meta.VITE_AWS_PLACE_INDEX_NAME;
const apiKey = import.meta.env.VITE_AWS_API_KEY;

// 2. Safety check to warn if an environment variable is missing
if (!region || !mapName || !apiKey) {
    console.error(
        "Missing required AWS configuration. Please verify your .env file contains VITE_AWS_REGION, VITE_AWS_MAP_NAME, and VITE_AWS_API_KEY."
    );
}

// 3. Construct the official Amazon Location Service style descriptor URL using environment variables
const awsMapStyle = `https://maps.geo.${region}.amazonaws.com/maps/v0/maps/${mapName}/style-descriptor?key=${apiKey}`;

// 4. Initialize the MapLibre GL map instance targeting the <div id="map">
const map = new maplibregl.Map({
    container: 'map',
    center: [-103.771556, 44.967244],
    zoom: 3.5,
    style: awsMapStyle
});

// 5. Add standard navigation controls (zoom in/out and compass)
map.addControl(new maplibregl.NavigationControl(), 'top-left');

let currentMarker = null;

map.on('click', async (e) => {
    const lngLat = e.lngLat;
    const coordinates = [lngLat.lng, lngLat.lat];

    if (currentMarker) {
        currentMarker.remove();
    }

    currentMarker = new maplibregl.Marker().setLngLat(coordinates).addTo(map);

});