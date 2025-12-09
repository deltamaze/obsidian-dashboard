export const handler = async (event) => {
    const apiKey = event.headers['api-key'] || event.headers['Api-Key'];
    const expectedKey = process.env.API_KEY;
    
    if (!apiKey || apiKey !== expectedKey) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Unauthorized' })
        };
    }
    
    try {
        // Get weather data (6 days instead of 7 to avoid confusion about "next week")
        const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=27.8006&longitude=-97.3964&current=temperature_2m&daily=temperature_2m_max,temperature_2m_min&hourly=precipitation_probability&temperature_unit=fahrenheit&timezone=America/Chicago&forecast_days=6';
        const weatherResponse = await fetch(weatherUrl);
        const weatherData = await weatherResponse.json();
        
        const currentTemp = weatherData.current.temperature_2m;
        const todayHigh = weatherData.daily.temperature_2m_max[0];
        const todayLow = weatherData.daily.temperature_2m_min[0];
        
        // Get UTC offset from the API and format it for ISO 8601 (e.g., "-06:00")
        const utcOffsetHours = weatherData.utc_offset_seconds / 3600;
        const offsetString = (utcOffsetHours >= 0 ? '+' : '-') + 
                            String(Math.abs(Math.floor(utcOffsetHours))).padStart(2, '0') + ':00';
        
        let nextRain = 'No rain forecasted for the next 6 days';
        const now = new Date();
        
        for (let i = 0; i < weatherData.hourly.precipitation_probability.length; i++) {
            if (weatherData.hourly.precipitation_probability[i] > 25) {
                // Append timezone offset so JavaScript correctly interprets the time
                let rainTime = new Date(weatherData.hourly.time[i] + offsetString);
                const hoursUntil = Math.round((rainTime - now) / (1000 * 60 * 60));
                
                if (hoursUntil <= 0) {
                    nextRain = 'Rain now';
                } else if (hoursUntil < 24) {
                    nextRain = `Rain in ${hoursUntil} hour${hoursUntil !== 1 ? 's' : ''}`;
                } else {
                    // Get hour in Central Time to check if it's midnight
                    const centralHour = parseInt(rainTime.toLocaleTimeString('en-US', { 
                        hour: 'numeric', 
                        hour12: false, 
                        timeZone: 'America/Chicago' 
                    }));
                    
                    // If it's midnight (00:00), treat it as 11PM of previous day
                    if (centralHour === 0) {
                        rainTime = new Date(rainTime.getTime() - 60 * 60 * 1000); // Subtract 1 hour
                    }
                    
                    const dayName = rainTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Chicago' });
                    
                    // Get the hour in Central Time (not UTC) - just hour, no minutes
                    const hour = parseInt(rainTime.toLocaleTimeString('en-US', { 
                        hour: 'numeric', 
                        hour12: false, 
                        timeZone: 'America/Chicago' 
                    }));
                    
                    const ampm = hour >= 12 ? 'PM' : 'AM';
                    const displayHour = hour % 12 || 12;
                    
                    nextRain = `Rain ${dayName} ${displayHour}${ampm}`;
                }
                break;
            }
        }
        
        // Get Google Calendar events
        const calendarEvents = await getCalendarEvents();
        
        return {
            statusCode: 200,
            body: JSON.stringify({
                weather: {
                    location: 'Corpus Christi, TX',
                    currentTemp: `${currentTemp}°F`,
                    todayHigh: `${todayHigh}°F`,
                    todayLow: `${todayLow}°F`,
                    nextRain
                },
                calendar: calendarEvents
            })
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};

async function getCalendarEvents() {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const token = await getGoogleAccessToken(credentials);
    
    const now = new Date();
    const next48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    
    const calendarIds = [
        'deltamaze@gmail.com', // Your personal calendar
        'okhf19sh3hnu32v27e7b180prc@group.calendar.google.com'// Add your couple calendar ID here (find it in calendar settings)
    ];
    
    // Get next 48 hours
    const next48Events = await fetchEventsInRange(calendarIds, token, now, next48Hours);
    
    // Get upcoming weekend
    const weekendEvents = await fetchUpcomingWeekend(calendarIds, token, now);
    
    return {
        next48Hours: next48Events,
        upcomingWeekend: weekendEvents
    };
}

async function fetchUpcomingWeekend(calendarIds, token, now) {
    const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday
    
    // Calculate days until the target weekend
    let daysUntilSaturday;
    
    if (dayOfWeek >= 5) {
        // Friday (5), Saturday (6), Sunday (0) - skip to NEXT weekend
        daysUntilSaturday = (13 - dayOfWeek) % 7 + 7; // Next week's Saturday
    } else {
        // Monday-Thursday - get this week's weekend
        daysUntilSaturday = 6 - dayOfWeek;
    }
    
    // Set to Saturday at midnight
    const saturday = new Date(now);
    saturday.setDate(saturday.getDate() + daysUntilSaturday);
    saturday.setHours(0, 0, 0, 0);
    
    // Sunday at 11:59 PM
    const sunday = new Date(saturday);
    sunday.setDate(sunday.getDate() + 1);
    sunday.setHours(23, 59, 59, 999);
    
    const events = await fetchEventsInRange(calendarIds, token, saturday, sunday);
    
    return {
        date: `${saturday.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} - ${sunday.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
        events
    };
}

async function fetchEventsInRange(calendarIds, token, startTime, endTime) {
    const allEvents = [];
    
    for (const calendarId of calendarIds) {
        const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${startTime.toISOString()}&timeMax=${endTime.toISOString()}&singleEvents=true&orderBy=startTime`;
        
        const response = await fetch(calendarUrl, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (data.items) {
            allEvents.push(...data.items.map(event => ({
                summary: event.summary,
                start: event.start.dateTime || event.start.date,
                end: event.end.dateTime || event.end.date,
                calendar: calendarId
            })));
        }
    }
    
    allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));
    return allEvents;
}

async function getGoogleAccessToken(credentials) {
    const jwtHeader = {
        alg: 'RS256',
        typ: 'JWT'
    };
    
    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = {
        iss: credentials.client_email,
        scope: 'https://www.googleapis.com/auth/calendar.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
    };
    
    // Create JWT
    const jwt = await createJWT(jwtHeader, jwtPayload, credentials.private_key);
    
    // Exchange JWT for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    
    const tokenData = await tokenResponse.json();
    return tokenData.access_token;
}

async function createJWT(header, payload, privateKey) {
    const encoder = new TextEncoder();
    
    // Base64url encode header and payload
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    
    const message = `${encodedHeader}.${encodedPayload}`;
    
    // Import private key
    const key = await crypto.subtle.importKey(
        'pkcs8',
        pemToArrayBuffer(privateKey),
        {
            name: 'RSASSA-PKCS1-v1_5',
            hash: 'SHA-256'
        },
        false,
        ['sign']
    );
    
    // Sign
    const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        key,
        encoder.encode(message)
    );
    
    const encodedSignature = base64UrlEncode(signature);
    
    return `${message}.${encodedSignature}`;
}

function base64UrlEncode(data) {
    let base64;
    if (typeof data === 'string') {
        base64 = Buffer.from(data).toString('base64');
    } else {
        base64 = Buffer.from(data).toString('base64');
    }
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function pemToArrayBuffer(pem) {
    const b64 = pem
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\s/g, '');
    const binaryString = Buffer.from(b64, 'base64');
    return binaryString.buffer.slice(binaryString.byteOffset, binaryString.byteOffset + binaryString.byteLength);
}