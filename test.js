process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
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
let timeEntryRaw = "";
for (let i = 0; i < weatherData.hourly.precipitation_probability.length; i++) {
  if (weatherData.hourly.precipitation_probability[i] > 25) {
    // Append timezone offset so JavaScript correctly interprets the time
    timeEntryRaw = weatherData.hourly.time[i];
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
console.log(`Current Temp: ${currentTemp}°F, High: ${todayHigh}°F, Low: ${todayLow}°F, Next Rain: ${nextRain}, Time Entry Raw: ${timeEntryRaw}`);