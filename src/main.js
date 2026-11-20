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

// Safety check to warn if an environment variable is missing
if (!region || !mapName || !userPoolId || !clientId || !identityPoolId) {
    console.error(
        "Missing required AWS configuration. Please verify your .env file contains VITE_AWS_REGION, VITE_AWS_MAP_NAME, VITE_AWS_USER_POOL_ID, VITE_AWS_USER_POOL_CLIENT_ID and VITE_AWS_IDENTITY_POOL_ID."
    );
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
const jsonContentEl = document.getElementById('json-content');

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
                jsonContentEl.textContent = JSON.stringify({
                    error: "Map initialization failed: " + mapErr.message
                }, null, 2);
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

    map.on('click', async (e) => {
        const lngLat = e.lngLat;
        const coordinates = [lngLat.lng, lngLat.lat];

        if (currentMarker) {
            currentMarker.remove();
        }
        currentMarker = new maplibregl.Marker().setLngLat(coordinates).addTo(map);

        const client = new LocationClient({
            region: region,
            ...authHelper.getLocationClientConfig()
        });

        try {
            const command = new SearchPlaceIndexForPositionCommand({
                IndexName: placeIndex,
                Position: coordinates,
                MaxResults: 1
            });

            const response = await client.send(command);
            jsonContentEl.textContent = JSON.stringify(response, null, 2);

            let locationName = "Selected Location";
            if (response.Results && response.Results.length > 0) {
                locationName = response.Results[0].Place.Label;
            }

            new maplibregl.Popup()
                .setLngLat(coordinates)
                .setHTML(`<strong>${locationName}</strong><br>Lng: ${lngLat.lng.toFixed(4)}, Lat: ${lngLat.lat.toFixed(4)}`)
                .addTo(map);

        } catch (error) {
            console.error("Error querying Amazon Location Service:", error);
            jsonContentEl.textContent = JSON.stringify({ error: error.message }, null, 2);
        }
    });
}
// Initial session check handled safely with catch to clear promise warning
checkUser().catch((err) => console.error("Session check error:", err));