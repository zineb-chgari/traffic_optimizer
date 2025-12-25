import axios from 'axios';

const TOMTOM_API_KEY = 'Cjx7i2N9ESmF9Sq8Bw6QtZ4FRJkCQMLy';

async function testGeocode(address) {
  console.log('\n=== TEST GEOCODING ===');
  console.log('Address:', address);
  
  try {
    const url = `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(address)}.json`;
    console.log('URL:', url);
    
    const response = await axios.get(url, {
      params: {
        key: TOMTOM_API_KEY,
        limit: 5,
        countrySet: 'MA'
      },
      timeout: 15000
    });
    
    console.log('\n✅ Response Status:', response.status);
    console.log('Results found:', response.data?.results?.length || 0);
    
    if (response.data?.results?.length > 0) {
      console.log('\n📍 Results:');
      response.data.results.forEach((result, i) => {
        console.log(`\n[${i + 1}] ${result.address.freeformAddress}`);
        console.log(`    Position: ${result.position.lat}, ${result.position.lon}`);
        console.log(`    Type: ${result.type}`);
        console.log(`    Score: ${result.score}`);
      });
    } else {
      console.log('\n❌ No results found');
      console.log('Full response:', JSON.stringify(response.data, null, 2));
    }
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

// Test multiple addresses
const addresses = [
  'Casablanca',
  'Rabat',
  'Ain Diab Casablanca',
  'Gare Casa Voyageurs Casablanca',
  'Casa Voyageurs',
  'Boulevard de la Corniche Casablanca'
];

console.log('🚀 Starting TomTom Geocoding Tests...\n');

for (const address of addresses) {
  await testGeocode(address);
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s between requests
}

console.log('\n✅ All tests completed');