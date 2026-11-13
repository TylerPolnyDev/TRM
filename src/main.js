import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './main.css';

// 1. Read environment variables securely using Vite's import.meta.env system
const region = import.meta.env.VITE_AWS_REGION;
const mapName = import.meta.env.VITE_AWS_MAP_NAME;
const placeIndex = import.meta.env.VITE_AWS_PLACE_INDEX_NAME;
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

// Listen for map click
map.on('click', async (e) => {
    const lngLat = e.lngLat;
    const coordinates = [lngLat.lng, lngLat.lat];

    // Remove marker if present
    if (currentMarker) {
        currentMarker.remove();
    }

    // Add marker to map at clicked location
    currentMarker = new maplibregl.Marker().setLngLat(coordinates).addTo(map);

    //Query Place Index
    const searchUrl = `https://places.geo.${region}.amazonaws.com/places/v0/indexes/${placeIndex}/search/position?key=${apiKey}`;

    try {
        const response = await fetch(searchUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                Position: coordinates,
                MaxResults: 1
            })
        });

        const data = await response.json();

        // Populate the JSON Response panel
        document.getElementById('json-content').textContent = JSON.stringify(data, null, 2);

        // Extract location label or fallback to coordinates
        let locationName = "Selected Location";
        if (data.Results && data.Results.length > 0) {
            locationName = data.Results[0].Place.Label;
        }

        // Open a popup alert/bubble over the pin showing the location name
        new maplibregl.Popup()
            .setLngLat(coordinates)
            .setHTML(`<strong>${locationName}</strong><br>Lng: ${lngLat.lng.toFixed(4)}, Lat: ${lngLat.lat.toFixed(4)}`)
            .addTo(map);

    } catch (error) {
        console.error("Error querying Amazon Location Service:", error);
        document.getElementById('json-content').textContent = JSON.stringify({ error: error.message }, null, 2);
    }
});