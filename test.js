const BACKEND_BASE_URL = "https://whs-science-mc.onrender.com";

document.getElementById("testBtn").addEventListener("click", async () => {
  const resultDiv = document.getElementById("result");
  resultDiv.textContent = "Testing connection...";

  try {
    const res = await fetch(`${BACKEND_BASE_URL}/api/test`);
    const data = await res.json();
    resultDiv.textContent = "Success: " + JSON.stringify(data);
  } catch (err) {
    resultDiv.textContent = "Error: " + err.message;
    console.error(err);
  }
});
