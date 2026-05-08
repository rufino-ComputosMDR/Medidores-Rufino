const map = L.map('map').setView([-34.262, -62.710], 15); 

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '©OpenStreetMap'
}).addTo(map);

let miGrafico; 
let datosMedidores = [];

fetch('medidores.geojson')
    .then(res => res.json())
    .then(data => {
        datosMedidores = data.features;

        // Calculamos el umbral para resaltar los 10 mayores consumos usando Cons-Inici
        const consumosSorted = [...datosMedidores]
            .map(f => parseFloat(f.properties["Cons-Inici"] || 0))
            .sort((a, b) => b - a);
        const limiteTop10 = consumosSorted[9] || 999999; 

        L.geoJSON(data, {
            pointToLayer: (feature, latlng) => {
                const consumo = parseFloat(feature.properties["Cons-Inici"] || 0);
                const esTop10 = consumo >= limiteTop10 && consumo > 0;
                
                return L.circleMarker(latlng, {
                    radius: esTop10 ? 9 : 6,
                    fillColor: esTop10 ? "#e67e22" : "#5dade2",
                    color: "#fff",
                    weight: 1.5,
                    fillOpacity: 0.85
                });
            },
            onEachFeature: (feature, layer) => {
                layer.on('click', () => mostrarFicha(feature.properties));
            }
        }).addTo(map);

        configurarBuscador();
    });

function configurarBuscador() {
    const input = document.getElementById('input-busqueda');
    const resultados = document.getElementById('resultados-busqueda');

    input.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        resultados.innerHTML = '';
        if (val.length < 2) { resultados.style.display = 'none'; return; }
        
        const filtrados = datosMedidores.filter(f => 
            f.properties.Domicilio.toLowerCase().includes(val) || 
            f.properties.Medidor.toLowerCase().includes(val)
        ).slice(0, 5);

        if (filtrados.length > 0) {
            filtrados.forEach(f => {
                const div = document.createElement('div');
                div.className = 'resultado-item';
                div.innerText = `${f.properties.Domicilio} (${f.properties.Medidor})`;
                div.onclick = () => {
                    map.setView([f.geometry.coordinates[1], f.geometry.coordinates[0]], 18);
                    mostrarFicha(f.properties);
                    resultados.style.display = 'none';
                    input.value = f.properties.Domicilio;
                };
                resultados.appendChild(div);
            });
            resultados.style.display = 'block';
        } else { resultados.style.display = 'none'; }
    });
}

function mostrarFicha(prop) {
    document.getElementById('ficha-medidor').style.display = 'block';
    document.getElementById('titulo-medidor').innerText = "Medidor: " + prop.Medidor;
    document.getElementById('info-domicilio').innerText = prop.Domicilio;
    document.getElementById('indicador-tendencia').innerHTML = ''; 
    cargarDatosGrafico(prop.Medidor);
}

function cargarDatosGrafico(idMedidor) {
    fetch('lecturas.geojson')
        .then(res => res.json())
        .then(data => {
            const features = data.features ? data.features.map(f => f.properties) : data;
            const registros = features.filter(p => String(p["Nro-Medidor"]) === String(idMedidor));
            
            if (registros.length === 0) {
                if (miGrafico) miGrafico.destroy();
                return;
            }

            // Cálculo de Tendencia comparando los dos últimos registros
            if (registros.length >= 2) {
                const ultimo = registros[registros.length - 1].Consumo;
                const anterior = registros[registros.length - 2].Consumo;
                const diff = (((ultimo - anterior) / (anterior || 1)) * 100).toFixed(1);
                const el = document.getElementById('indicador-tendencia');
                
                if (ultimo >= anterior) {
                    el.innerHTML = `<span class="tendencia subio">⬆️ +${diff}%</span>`;
                } else {
                    el.innerHTML = `<span class="tendencia bajo">⬇️ ${diff}%</span>`;
                }
            }

            dibujarGrafico(registros.map(r => r.Fecha), registros.map(r => r.Consumo));
        });
}

function dibujarGrafico(meses, datos) {
    const ctx = document.getElementById('graficoMediciones').getContext('2d');
    if (miGrafico) miGrafico.destroy();
    Chart.register(ChartDataLabels);

    const maxVal = Math.max(...datos);
    const sugeridoMax = maxVal + (maxVal * 0.3); // Margen extra para que se vea el kWh

    miGrafico = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: meses,
            datasets: [{
                data: datos,
                backgroundColor: 'rgba(93, 173, 226, 0.7)',
                borderColor: '#5dade2',
                borderWidth: 1,
                borderRadius: 4,
                datalabels: {
                    anchor: 'end',
                    align: 'top',
                    font: { size: 10, weight: 'bold' },
                    color: '#2e86c1',
                    formatter: (v) => v + " kWh"
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, datalabels: { display: true } },
            scales: {
                y: { 
                    beginAtZero: true, 
                    suggestedMax: sugeridoMax, 
                    grid: { display: false }, 
                    ticks: { display: false }, 
                    border: { display: false } 
                },
                x: { grid: { display: false }, ticks: { font: { size: 10 } } }
            }
        }
    });
}