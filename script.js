const map = L.map('map').setView([-34.262, -62.710], 14); 
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

let todasLasLecturas = [];
let datosMedidores = [];
let capaGeoJSON;
let miGrafico;

// CARGA INICIAL
Promise.all([
    fetch('medidores.geojson').then(res => res.json()),
    fetch('lecturas.geojson').then(res => res.json())
]).then(([medidores, lecturas]) => {
    datosMedidores = medidores.features;
    const raw = lecturas.features ? lecturas.features.map(f => f.properties) : lecturas;

    todasLasLecturas = raw.map(l => {
        // Soporte para caracteres extraños en "Liq-Año"
        let claveAnio = Object.keys(l).find(k => k.includes("Liq-") && (k.includes("o") || k.includes("")));
        let anio = l[claveAnio] || l["Liq-Año"] || "0000";
        let cuota = l["Liq-Cuota"] || "0";
        return {
            ...l,
            Periodo: `${anio}-${String(cuota).padStart(2, '0')}`,
            MedidorID: String(l["Nro-Medidor"] || l["Medidor"])
        };
    });

    configurarSelectorPeriodos();
    configurarBuscador();
    actualizarCapaTop10();
});

function configurarSelectorPeriodos() {
    const select = document.getElementById('select-periodo');
    const periodos = [...new Set(todasLasLecturas.map(l => l.Periodo))].sort().reverse();
    periodos.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p; opt.innerText = p;
        select.appendChild(opt);
    });
}

function actualizarCapaTop10() {
    if (capaGeoJSON) map.removeLayer(capaGeoJSON);
    const periodo = document.getElementById('select-periodo').value;
    const idsTop10 = [...todasLasLecturas].filter(l => l.Periodo === periodo)
                        .sort((a, b) => b.Consumo - a.Consumo).slice(0, 10).map(l => l.MedidorID);

    capaGeoJSON = L.geoJSON({type: "FeatureCollection", features: datosMedidores}, {
        pointToLayer: (feature, latlng) => {
            const esTop10 = idsTop10.includes(String(feature.properties.Medidor));
            return L.circleMarker(latlng, { radius: esTop10 ? 9 : 6, fillColor: esTop10 ? "#e67e22" : "#5dade2", color: "#fff", weight: 1.5, fillOpacity: 0.8 });
        },
        onEachFeature: (f, l) => l.on('click', () => mostrarFicha(f.properties))
    }).addTo(map);
}

// FICHA TÉCNICA Y GRÁFICO
function mostrarFicha(prop) {
    document.getElementById('ficha-medidor').style.display = 'block';
    document.getElementById('titulo-medidor').innerText = "Medidor: " + prop.Medidor;
    document.getElementById('info-domicilio').innerText = prop.Domicilio;
    
    const registros = todasLasLecturas.filter(p => p.MedidorID === String(prop.Medidor)).sort((a, b) => a.Periodo.localeCompare(b.Periodo));
    const contenedorTendencia = document.getElementById('indicador-tendencia');
    contenedorTendencia.innerHTML = '';

    if (registros.length >= 2) {
        const actual = registros[registros.length - 1].Consumo;
        const anterior = registros[registros.length - 2].Consumo;
        if (anterior > 0) {
            const porc = (((actual - anterior) / anterior) * 100).toFixed(1);
            const subio = actual > anterior;
            contenedorTendencia.innerHTML = `<span style="color:${subio?'#e74c3c':'#27ae60'}; font-weight:bold; font-size:12px; background:${subio?'#fdedec':'#eafaf1'}; padding:2px 5px; border-radius:4px;">${subio?'▲':'▼'} ${porc}%</span>`;
        }
    }
    dibujarGrafico(registros.map(r => r.Periodo), registros.map(r => r.Consumo));
}

function dibujarGrafico(labels, datos) {
    const ctx = document.getElementById('graficoMediciones').getContext('2d');
    if (miGrafico) miGrafico.destroy();
    Chart.register(ChartDataLabels);
    miGrafico = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: datos, backgroundColor: '#5dade2', borderRadius: 4,
                datalabels: { anchor: 'end', align: 'top', formatter: (v) => v + ' kWh', font: { weight: 'bold', size: 10 }, color: '#2c3e50' }
            }]
        },
        options: { 
            responsive: true, maintainAspectRatio: false, layout: { padding: { top: 25 } },
            plugins: { legend: { display: false }, datalabels: { display: true } },
            scales: { y: { beginAtZero: true, suggestedMax: Math.max(...datos, 0) * 1.3, ticks: { display: false }, grid: { display: false } }, x: { grid: { display: false } } }
        }
    });
}

// REPORTE 1: POR MES
function verVistaPrevia() {
    const periodo = document.getElementById('select-periodo').value;
    const lecturasMes = todasLasLecturas.filter(l => l.Periodo === periodo).sort((a,b) => b.Consumo - a.Consumo);
    const total = lecturasMes.reduce((acc, c) => acc + (parseFloat(c.Consumo) || 0), 0);
    const idsTop10 = lecturasMes.slice(0, 10).map(l => l.MedidorID);

    document.getElementById('preview-titulo').innerText = `Reporte Mensual: ${periodo}`;
    document.getElementById('resumen-texto').innerHTML = `<b>Consumo Total Red:</b> ${total.toLocaleString()} kWh | <b>Medidores:</b> ${lecturasMes.length}`;

    let html = `<table class="tabla-preview"><thead><tr><th>#</th><th>Medidor</th><th>Domicilio</th><th>Consumo</th></tr></thead><tbody>`;
    lecturasMes.forEach((l, i) => {
        const med = datosMedidores.find(m => String(m.properties.Medidor) === l.MedidorID);
        html += `<tr class="${idsTop10.includes(l.MedidorID) ? 'fila-top' : ''}"><td>${i+1}</td><td>${l.MedidorID}</td><td>${med?med.properties.Domicilio:'N/D'}</td><td>${l.Consumo.toLocaleString()} kWh</td></tr>`;
    });
    document.getElementById('preview-tabla-container').innerHTML = html + "</tbody></table>";
    document.getElementById('btn-descarga-final').onclick = () => generarPDFMensual(periodo, lecturasMes, total);
    document.getElementById('modal-reporte').style.display = 'block';
}

function generarPDFMensual(per, datos, tot) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.text(`REPORTE MENSUAL RUFINO - ${per}`, 14, 15);
    doc.text(`Total Red: ${tot.toLocaleString()} kWh`, 14, 22);
    const filas = datos.map((l, i) => [i+1, l.MedidorID, (datosMedidores.find(m => String(m.properties.Medidor) === l.MedidorID)?.properties.Domicilio || 'N/D'), l.Consumo + ' kWh']);
    doc.autoTable({ startY: 30, head: [['#', 'Medidor', 'Domicilio', 'Consumo']], body: filas });
    doc.save(`Reporte_Mensual_${per}.pdf`);
}

// REPORTE 2: MATRIZ HISTÓRICA TOTAL
function verVistaPreviaGeneral() {
    const periodos = [...new Set(todasLasLecturas.map(l => l.Periodo))].sort();
    const listaMedidores = [...new Set(todasLasLecturas.map(l => l.MedidorID))].sort();
    const totalesColumna = {}; 
    periodos.forEach(p => totalesColumna[p] = 0);

    document.getElementById('preview-titulo').innerText = `Reporte Histórico Comparativo`;
    document.getElementById('resumen-texto').innerText = `Consumo por medidor comparado por periodos y totalización por columna.`;

    let html = `<table class="tabla-preview"><thead><tr><th>Medidor</th><th>Domicilio</th>`;
    periodos.forEach(p => html += `<th>${p}</th>`);
    html += `</tr></thead><tbody>`;

    listaMedidores.forEach(mID => {
        const medInfo = datosMedidores.find(m => String(m.properties.Medidor) === mID);
        html += `<tr><td>${mID}</td><td>${medInfo ? medInfo.properties.Domicilio : 'N/D'}</td>`;
        periodos.forEach(p => {
            const lec = todasLasLecturas.find(l => l.MedidorID === mID && l.Periodo === p);
            const val = lec ? parseFloat(lec.Consumo) : 0;
            html += `<td>${val > 0 ? val.toLocaleString() : '-'}</td>`;
            totalesColumna[p] += val;
        });
        html += `</tr>`;
    });

    html += `<tr class="total-row"><td colspan="2">TOTAL RED POR PERÍODO</td>`;
    periodos.forEach(p => html += `<td>${totalesColumna[p].toLocaleString()}</td>`);
    html += `</tr></tbody></table>`;

    document.getElementById('preview-tabla-container').innerHTML = html;
    document.getElementById('btn-descarga-final').onclick = () => generarPDFGeneral(periodos, listaMedidores, totalesColumna);
    document.getElementById('modal-reporte').style.display = 'block';
}

function generarPDFGeneral(periodos, medidores, totales) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4');
    doc.text("REPORTE HISTÓRICO TOTALIZADO", 14, 15);
    const body = medidores.map(mID => {
        const fila = [mID, (datosMedidores.find(m => String(m.properties.Medidor) === mID)?.properties.Domicilio || 'N/D')];
        periodos.forEach(p => {
            const lec = todasLasLecturas.find(l => l.MedidorID === mID && l.Periodo === p);
            fila.push(lec ? lec.Consumo.toLocaleString() : '0');
        });
        return fila;
    });
    body.push(['TOTAL', 'RED', ...periodos.map(p => totales[p].toLocaleString())]);
    doc.autoTable({ startY: 25, head: [['Medidor', 'Domicilio', ...periodos]], body: body, theme: 'grid', styles: { fontSize: 7 } });
    doc.save(`Reporte_Historico_General.pdf`);
}

function cerrarModal() { document.getElementById('modal-reporte').style.display = 'none'; }

function configurarBuscador() {
    const input = document.getElementById('input-busqueda');
    const resultados = document.getElementById('resultados-busqueda');
    input.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        resultados.innerHTML = '';
        if (val.length < 2) { resultados.style.display = 'none'; return; }
        const filtrados = datosMedidores.filter(f => f.properties.Domicilio.toLowerCase().includes(val) || String(f.properties.Medidor).includes(val)).slice(0, 5);
        filtrados.forEach(f => {
            const div = document.createElement('div');
            div.className = 'resultado-item';
            div.innerText = `${f.properties.Domicilio} (${f.properties.Medidor})`;
            div.onclick = () => { map.setView([f.geometry.coordinates[1], f.geometry.coordinates[0]], 18); mostrarFicha(f.properties); resultados.style.display = 'none'; };
            resultados.appendChild(div);
        });
        resultados.style.display = filtrados.length ? 'block' : 'none';
    });
}