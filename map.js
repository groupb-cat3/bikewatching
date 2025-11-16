// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoiZ29sa2VsIiwiYSI6ImNtaTE2cnMzYjEzanIya3EwZ29wOXM0OTgifQ.Px5fraKDwTaymmNdAPpgrw';

// Global variables for performance optimization
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

// Helper function to convert coordinates
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
  const { x, y } = map.project(point); // Project to pixel coordinates
  return { cx: x, cy: y }; // Return as object for use in SVG attributes
}

// Helper function to format time
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
  return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

// Helper function to get minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Helper function to filter trips by minute (optimized)
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); // No filtering, return all trips
  }

  // Normalize both min and max minutes to the valid range [0, 1439]
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  // Handle time filtering across midnight
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// Function to compute station traffic
function computeStationTraffic(stations, timeFilter = -1) {
  // Retrieve filtered trips efficiently
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter), // Efficient retrieval
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter), // Efficient retrieval
    (v) => v.length,
    (d) => d.end_station_id
  );

  // Update station data with filtered counts (create new objects to avoid mutation)
  return stations.map((station) => {
    let id = station.short_name;
    return {
      ...station,
      arrivals: arrivals.get(id) ?? 0,
      departures: departures.get(id) ?? 0,
      totalTraffic: (arrivals.get(id) ?? 0) + (departures.get(id) ?? 0),
    };
  });
}

// Wait for the map to load before adding data
map.on('load', async () => {
  // Add Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 5,
      'line-opacity': 0.6,
    },
  });

  // Add Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://data.cambridgema.gov/api/geospatial/8xfd-6pvp?method=export&format=GeoJSON',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 5,
      'line-opacity': 0.6,
    },
  });

  // Select the SVG element inside the map container
  const svg = d3.select('#map').select('svg');

  // Fetch and parse station data
  let jsonData;
  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData); // Log to verify structure
  } catch (error) {
    console.error('Error loading JSON:', error); // Handle errors
  }

  // Keep original stations array (without traffic data)
  const originalStations = jsonData.data.stations;
  console.log('Stations Array:', originalStations);

  // Fetch and parse traffic data
  let trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);

      // Add trips to minute buckets for performance optimization
      let startedMinutes = minutesSinceMidnight(trip.started_at);
      departuresByMinute[startedMinutes].push(trip);

      let endedMinutes = minutesSinceMidnight(trip.ended_at);
      arrivalsByMinute[endedMinutes].push(trip);

      return trip;
    }
  );

  // Compute initial station traffic
  let stations = computeStationTraffic(originalStations);

  // Create radius scale for circle sizing
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // Create quantize scale for traffic flow (departures vs arrivals)
  const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

  // Append circles to the SVG for each station
  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name) // Use station short_name as the key
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic)) // Radius of the circle
    .attr('fill', 'steelblue') // Circle fill color (will be overridden by CSS variable)
    .attr('stroke', 'white') // Circle border color
    .attr('stroke-width', 1) // Circle border thickness
    .attr('opacity', 0.8) // Circle opacity
    .style('--departure-ratio', (d) =>
      stationFlow(d.departures / d.totalTraffic || 0)
    )
    .attr('cx', (d) => getCoords(d).cx) // Set initial x-position
    .attr('cy', (d) => getCoords(d).cy) // Set initial y-position
    .each(function (d) {
      // Add <title> for browser tooltips
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });

  // Function to update circle positions when the map moves/zooms
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx) // Set the x-position using projected coordinates
      .attr('cy', (d) => getCoords(d).cy); // Set the y-position using projected coordinates
  }

  // Initial position update when map loads
  updatePositions();

  // Reposition markers on map interactions
  map.on('move', updatePositions); // Update during map movement
  map.on('zoom', updatePositions); // Update during zooming
  map.on('resize', updatePositions); // Update on window resize
  map.on('moveend', updatePositions); // Final adjustment after movement ends

  // Get slider and display elements
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  // Function to update scatterplot based on time filter
  function updateScatterPlot(timeFilter) {
    // Recompute station traffic based on the filtered trips (use original stations)
    const filteredStations = computeStationTraffic(originalStations, timeFilter);

    // Adjust scale range based on filtering
    timeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    // Update the scatterplot by adjusting the radius and color of circles
    circles
      .data(filteredStations, (d) => d.short_name) // Ensure D3 tracks elements correctly
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic)) // Update circle sizes
      .style('--departure-ratio', (d) =>
        stationFlow((d.departures / d.totalTraffic) || 0)
      )
      .attr('cx', (d) => getCoords(d).cx) // Update x-position
      .attr('cy', (d) => getCoords(d).cy) // Update y-position
      .each(function (d) {
        // Update tooltip - remove existing title and add new one
        d3.select(this).select('title').remove();
        d3.select(this)
          .append('title')
          .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
          );
      });
  }

  // Function to update time display
  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value); // Get slider value

    if (timeFilter === -1) {
      selectedTime.textContent = ''; // Clear time display
      anyTimeLabel.style.display = 'block'; // Show "(any time)"
    } else {
      selectedTime.textContent = formatTime(timeFilter); // Display formatted time
      anyTimeLabel.style.display = 'none'; // Hide "(any time)"
    }

    // Call updateScatterPlot to reflect the changes on the map
    updateScatterPlot(timeFilter);
  }

  // Bind the slider's input event to our function
  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay(); // Initial call
});

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);
