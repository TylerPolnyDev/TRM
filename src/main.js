import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './main.css';
import { Amplify } from 'aws-amplify';
import { signIn, signUp, confirmSignUp, signOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import { LocationClient, SearchPlaceIndexForPositionCommand } from '@aws-sdk/client-location';
import { withIdentityPoolId } from '@aws/amazon-location-utilities-auth-helper';

// Read environment variables securely using Vite's import.meta.env system
const region = import.meta.env.VITE_AWS_REGION;
const mapName = import.meta.env.VITE_AWS_MAP_NAME;
const placeIndex = import.meta.env.VITE_AWS_PLACE_INDEX_NAME;
const userPoolId = import.meta.env.VITE_AWS_USER_POOL_ID;
const clientId = import.meta.env.VITE_AWS_USER_POOL_CLIENT_ID;
const identityPoolId = import.meta.env.VITE_AWS_IDENTITY_POOL_ID;
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '');

// Safety check to warn if an environment variable is missing
if (!region || !mapName || !userPoolId || !clientId || !identityPoolId) {
    console.error(
        "Missing required AWS configuration. Please verify your .env file contains VITE_AWS_REGION, VITE_AWS_MAP_NAME, VITE_AWS_USER_POOL_ID, VITE_AWS_USER_POOL_CLIENT_ID and VITE_AWS_IDENTITY_POOL_ID."
    );
}
if (!apiBaseUrl) {
    console.warn("VITE_API_BASE_URL is not set in .env; area insights API requests will not run.");
}
// Configure Amplify Auth
Amplify.configure({
    Auth:{
        Cognito: {
            userPoolId: userPoolId,
            userPoolClientId: clientId,
            identityPoolId: identityPoolId
        }
    }
});

// DOM Element Caching
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');
const authForm = document.getElementById('auth-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const confirmationCodeInput = document.getElementById('confirmation-code');
const authMessage = document.getElementById('auth-message');
const signinBtn = document.getElementById('signin-btn');
const signupBtn = document.getElementById('signup-btn');
const confirmBtn = document.getElementById('confirm-btn');
const returnMessage = document.getElementById("return-message");
const returnBtn = document.getElementById("return-to-signin");
const logoutBtn = document.getElementById('logout-btn');
const areaStatusEl = document.querySelector('.placeholder-text');
const weatherContentEl = document.getElementById('weather-content');
const gasContentEl = document.getElementById('gas-content');
const crimeContentEl = document.getElementById('crime-content');

function setInsightsLoading(locationLabel) {
    if (areaStatusEl) {
        areaStatusEl.textContent = `Loading area insights for ${locationLabel}...`;
        areaStatusEl.classList.remove('error-text');
    }
    weatherContentEl.textContent = "Loading...";
    gasContentEl.textContent = "Loading...";
    crimeContentEl.textContent = "Loading...";
}
function setInsightsError(message) {
    if (areaStatusEl) {
        areaStatusEl.textContent = message;
        areaStatusEl.classList.add('error-text');
    }
    weatherContentEl.textContent = "Unavailable";
    gasContentEl.textContent = "Unavailable";
    crimeContentEl.textContent = "Unavailable";
}

function renderInsights(data) {
    if (areaStatusEl) {
        areaStatusEl.textContent = `Area: ${data.region || "Selected Location"}`;
        areaStatusEl.classList.remove('error-text');
    }

    const weather = data.weather || {};
    if (weather.temperatureF !== null && weather.temperatureF !== undefined) {
        const windPart = weather.windMph !== null && weather.windMph !== undefined
            ? ` · Wind: ${weather.windMph} mph`
            : "";
        weatherContentEl.textContent = `${weather.temperatureF}°F${windPart}`;
    } else {
        weatherContentEl.textContent = weather.summary || "Unavailable";
    }

    const gas = data.gasPrice || {};
    if (gas.averageRegularUsd !== null && gas.averageRegularUsd !== undefined) {
        gasContentEl.textContent = `$${Number(gas.averageRegularUsd).toFixed(2)} / gal (${gas.area || data.region || "Area"})`;
    } else {
        gasContentEl.textContent = gas.note || "No gas price data available yet.";
    }

    const crime = data.crimeRate || {};
    if (crime.ratePer100k !== null && crime.ratePer100k !== undefined) {
        crimeContentEl.textContent = `${crime.ratePer100k} per 100k (${crime.area || data.region || "Area"})`;
    } else {
        crimeContentEl.textContent = crime.note || "No crime rate data available yet.";
    }
}

async function fetchAreaInsights(lat, lng, regionLabel, idToken) {
    if (!apiBaseUrl) {
        setInsightsError("Missing VITE_API_BASE_URL in .env.");
        return;
    }

    const url = `${apiBaseUrl}/insights?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&region=${encodeURIComponent(regionLabel)}`;
    const headers = {};
    if (idToken) {
        headers.Authorization = `Bearer ${idToken}`;
    }

    const res = await fetch(url, { method: "GET", headers });
    if (!res.ok) {
        throw new Error(`Insights API returned ${res.status}`);
    }
    return res.json();
}

// Check if user is logged in.
async function checkUser() {
    try {
        const user = await getCurrentUser();
        if (user) {
            authContainer.style.display = 'none';
            appContainer.style.display = 'block';
            try {
                await initMap();
            } catch (mapErr) {
                console.error("Map initialization error:", mapErr);
                setInsightsError(`Map initialization failed: ${mapErr.message}`);
            }
        } else {
            authContainer.style.display = 'flex';
            appContainer.style.display = 'none';
        }
    } catch {
        // Clear any stale session and show sign-in
        try {
            await signOut();
        } catch {}
        authContainer.style.display = 'flex';
        appContainer.style.display = 'none';
    }
}

// Handles action for submit button clicked by user
authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        // Clear any lingering session before attempting a fresh sign-in
        try {
            await signOut();
        } catch {}

        await signIn({
            username: emailInput.value,
            password: passwordInput.value
        });
        await checkUser();
    } catch (err) {
        authMessage.textContent = err.message;
    }
});

// Handles action for sign-up button clicked by user
signupBtn.addEventListener('click', async ()=> {
    try{
        await signUp({
            username: emailInput.value,
            password: passwordInput.value,
            options: { userAttributes: { email: emailInput.value } }
        });
        authMessage.textContent = "Account created! Check your email for a confirmation code.";

        // Update UI to show confirmation code input
        confirmationCodeInput.style.display = "block";
        confirmBtn.style.display = 'inline-block';
        returnMessage.style.display = "block";
        returnBtn.style.display ="inline-block";
        signupBtn.style.display = 'none';
        signinBtn.style.display = 'none';
    } catch (err) {
        authMessage.textContent = err.message;
    }
});

// Handles action for returnBtn clicked
returnBtn.addEventListener('click', async() => {
    confirmationCodeInput.style.display = "none";
    confirmBtn.style.display = 'none';
    returnMessage.style.display = "none";
    returnBtn.style.display ="none";
    signupBtn.style.display = 'inline-block';
    signinBtn.style.display = 'inline-block';
    authMessage.textContent = '';

});

// Handles action for confirm button clicked by user
confirmBtn.addEventListener('click', async () => {
    try {
        await confirmSignUp({
            username: emailInput.value,
            confirmationCode: confirmationCodeInput.value
        });
        authMessage.textContent = "Account confirmed successfully! You can now sign in.";

        // Update UI to show standard sign-in view
        confirmationCodeInput.style.display = "none";
        confirmBtn.style.display = "none";
        signupBtn.style.display = 'inline-block';
        signinBtn.style.display = 'inline-block';
        returnMessage.style.display = "none";
        returnBtn.style.display = "none";

    } catch (e) {
        authMessage.textContent = e.message;
    }
});

// Handles action for logout button
logoutBtn.addEventListener('click', async () => {
    await signOut();
    window.location.reload();
});

// Initialize map and location service using official auth helper with authenticated user tokens
async function initMap() {
    // Retrieve the authenticated user's session and ID token from Amplify
    const session = await fetchAuthSession();
    const idToken = session.tokens?.idToken?.toString();

    // Configure the auth helper with the Cognito User Pool login provider
    const authHelper = await withIdentityPoolId(identityPoolId, {
        logins: {
            [`cognito-idp.${region}.amazonaws.com/${userPoolId}`]: idToken
        }
    });

    const map = new maplibregl.Map({
        container: 'map',
        center: [-103.771556, 44.967244],
        zoom: 3.5,
        style: `https://maps.geo.${region}.amazonaws.com/maps/v0/maps/${mapName}/style-descriptor`,
        ...authHelper.getMapAuthenticationOptions()
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-left');

    let currentMarker = null;
    const locationClient = new LocationClient({
        region: region,
        ...authHelper.getLocationClientConfig()
    });

    map.on('click', async (e) => {
        const lngLat = e.lngLat;
        const coordinates = [lngLat.lng, lngLat.lat];

        if (currentMarker) {
            currentMarker.remove();
        }
        currentMarker = new maplibregl.Marker().setLngLat(coordinates).addTo(map);

        let locationName = "Selected Location";
        let regionLabel = "";

        try {
            const command = new SearchPlaceIndexForPositionCommand({
                IndexName: placeIndex,
                Position: coordinates,
                MaxResults: 1
            });

            const response = await locationClient.send(command);
            const place = response.Results?.[0]?.Place;
            if (place) {
                locationName = place.Label || locationName;
                regionLabel = place.Region || place.Municipality || place.Label || "";
            }
        } catch (error) {
            console.error("Error querying Amazon Location Service:", error);
        }

        new maplibregl.Popup()
            .setLngLat(coordinates)
            .setHTML(`<strong>${locationName}</strong><br>Lng: ${lngLat.lng.toFixed(4)}, Lat: ${lngLat.lat.toFixed(4)}`)
            .addTo(map);

        setInsightsLoading(locationName);

        try {
            // Refresh session in case the user has been active for a while
            const freshSession = await fetchAuthSession();
            const freshIdToken = freshSession.tokens?.idToken?.toString() || idToken;
            const insightsData = await fetchAreaInsights(lngLat.lat, lngLat.lng, regionLabel, freshIdToken);
            renderInsights(insightsData);
        } catch (err) {
            console.error("Error fetching area insights:", err);
            setInsightsError(`Could not load area insights: ${err.message}`);
        }
    });
}
// Initial session check handled safely with catch to clear promise warning
checkUser().catch((err) => console.error("Session check error:", err));