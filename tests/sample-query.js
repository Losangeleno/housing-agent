import axios from "axios";

async function run() {
  const body = {
    query: "affordable housing",
    maxRent: 2800,
    minBedrooms: 1
  };
  const { data } = await axios.post("http://localhost:3010/housing/search", body, { timeout: 60000 });
  console.log(JSON.stringify(data, null, 2));
}

run().catch(e => {
  console.error(e.response?.data || e.message);
  process.exit(1);
});
