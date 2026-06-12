const map = L.map('map', {
    zoomControl: window.innerWidth > 767 
}).setView([-34.262, -62.710], 15); 

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '©OpenStreetMap'
}).addTo(map);

if(window.innerWidth <= 767) {
    L.control.zoom({ position: 'topright' }).addTo(map);
}

let miGrafico; 
let miGraficoMaxi; 
let ultimoLabels = []; 
let ultimoDatos = [];  
let cuentaSeleccionadaTexto = ""; 
let datosMedidores = [];      
let todasLasLecturas = [];    
let capaPuntosMapa = null;    
let filtroMunicipalActivo = false; 

const buscarClaveAnio = (obj) => {
    return Object.keys(obj).find(k => k.toLowerCase().includes("liq-a")) || "Liq-Año";
};

const extraerDireccion = (prop) => {
    if (!prop) return 'Sin Dirección';
    return prop.Ubicacion || prop.Domicilio || 'Sin Dirección';
};

const formatearPeriodoISO = (cuota, anio) => {
    const mesStr = String(cuota).padStart(2, '0');
    return `${anio}-${mesStr}`;
};

// ==========================================
// 1. CARGA INICIAL COMPLETA Y CRUCE DE DATOS
// ==========================================
fetch('lecturas.geojson')
    .then(res => res.json())
    .then(data => {
        todasLasLecturas = data.features ? data.features.map(f => f.properties) : data;
        return fetch('medidores.geojson');
    })
    .then(res => res.json())
    .then(data => {
        datosMedidores = data.features;

        const mapaMunicipalesBase = {};
        datosMedidores.forEach(f => {
            if (f.properties && f.properties.Cuenta) {
                const cuentaNormalizada = String(f.properties.Cuenta).trim();
                mapaMunicipalesBase[cuentaNormalizada] = String(f.properties["Dep-Munic"] || "").toUpperCase() === "SI";
            }
        });

        todasLasLecturas.forEach(r => {
            const padronNormalizado = String(r.Padron).trim();
            if (mapaMunicipalesBase[padronNormalizado]) {
                r["Dep-Munic"] = "SI";
            }
        });

        const periodosUnicos = [];
        const mapeoClaves = {};

        todasLasLecturas.forEach(r => {
            const keyAnio = buscarClaveAnio(r);
            const claveUnica = `${r["Liq-Cuota"]}-${r[keyAnio]}`;
            if (!mapeoClaves[claveUnica]) {
                mapeoClaves[claveUnica] = true;
                periodosUnicos.push({
                    cuota: r["Liq-Cuota"],
                    anio: r[keyAnio],
                    texto: formatearPeriodoISO(r["Liq-Cuota"], r[keyAnio])
                });
            }
        });

        periodosUnicos.sort((a, b) => a.anio - b.anio || a.cuota - b.cuota);

        const select = document.getElementById('select-periodo');
        select.innerHTML = '';
        periodosUnicos.forEach(p => {
            const opt = document.createElement('option');
            opt.value = `${p.cuota}|${p.anio}`;
            opt.innerText = p.texto;
            select.appendChild(opt);
        });
        
        if (periodosUnicos.length > 0) {
            select.value = `${periodosUnicos[periodosUnicos.length-1].cuota}|${periodosUnicos[periodosUnicos.length-1].anio}`;
        }

        actualizarPuntosPorMes();
        configurarBuscador();
    })
    .catch(err => console.error("Error cargando bases de datos:", err));

function toggleFiltroMunicipal() {
    filtroMunicipalActivo = !filtroMunicipalActivo;
    const btn = document.getElementById('btn-filtro-municipal');
    if (filtroMunicipalActivo) {
        btn.classList.add('activo');
    } else {
        btn.classList.remove('activo');
    }
    actualizarPuntosPorMes();
}

// ==========================================
// 2. REFRESCAR PUNTOS MAPA
// ==========================================
function actualizarPuntosPorMes() {
    const periodoSeleccionado = document.getElementById('select-periodo').value;
    if (!periodoSeleccionado) return;
    const [cuota, anio] = periodoSeleccionado.split('|');

    if (capaPuntosMapa) {
        map.removeLayer(capaPuntosMapa);
    }

    let medidoresAFiltrar = datosMedidores;
    if (filtroMunicipalActivo) {
        medidoresAFiltrar = datosMedidores.filter(f => String(f.properties["Dep-Munic"]).toUpperCase() === "SI");
    }

    const lecturasDelMes = todasLasLecturas.filter(r => String(r["Liq-Cuota"]) === cuota && String(r[buscarClaveAnio(r)]) === anio);
    const consumosMesSorted = lecturasDelMes.map(l => parseFloat(l.Consumo || 0)).sort((a, b) => b - a);
    const limiteTop10Mes = consumosMesSorted[9] || 999999;

    const mapaLecturasRapido = {};
    lecturasDelMes.forEach(l => {
        mapaLecturasRapido[String(l.Padron).trim()] = l;
    });

    capaPuntosMapa = L.layerGroup();

    medidoresAFiltrar.forEach(feature => {
        if (!feature.geometry || !feature.geometry.coordinates) return;
        
        const latlng = [feature.geometry.coordinates[1], feature.geometry.coordinates[0]];
        const idCuenta = String(feature.properties.Cuenta).trim();
        const lecturaAsociada = mapaLecturasRapido[idCuenta];
        const consumoMes = lecturaAsociada ? parseFloat(lecturaAsociada.Consumo || 0) : 0;
        const esTop10 = consumoMes >= limiteTop10Mes && consumoMes > 0;
        const esMunicipal = String(feature.properties["Dep-Munic"]).toUpperCase() === "SI";

        let marcador;

        if (esMunicipal) {
            const tamanoEscudo = esTop10 ? 24 : 20;
            const colorResplandor = esTop10 ? "#e67e22" : "#5dade2"; 

            const HTMLEscudoEsfumado = L.divIcon({
                html: `<div style="
                            width: ${tamanoEscudo}px; 
                            height: ${tamanoEscudo}px; 
                            border-radius: 50%; 
                            box-shadow: 0 0 10px 3px ${colorResplandor}; 
                            background-color: white; 
                            overflow: hidden; 
                            display: flex; 
                            align-items: center; 
                            justify-content: center;">
                        <img src="logo.png" style="width: 90%; height: 90%; object-fit: contain;" />
                       </div>`,
                className: 'marcador-escudo-esfumado',
                iconSize: [tamanoEscudo, tamanoEscudo],
                iconAnchor: [tamanoEscudo / 2, tamanoEscudo / 2]
            });

            marcador = L.marker(latlng, { icon: HTMLEscudoEsfumado });
        } else {
            const radioCentro = esTop10 ? 9 : 6;
            const colorFinal = esTop10 ? "#e67e22" : "#5dade2"; 
            marcador = L.circleMarker(latlng, {
                radius: radioCentro,
                fillColor: colorFinal,
                color: "#fff",
                weight: 1.5,
                fillOpacity: 0.85
            });
        }

        marcador.on('click', () => mostrarFicha(feature.properties));
        marcador.addTo(capaPuntosMapa);
    });

    capaPuntosMapa.addTo(map);
}

// ==========================================
// 3. CONFIGURACIÓN DEL BUSCADOR
// ==========================================
function configurarBuscador() {
    const input = document.getElementById('input-busqueda');
    const resultados = document.getElementById('resultados-busqueda');

    input.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        resultados.innerHTML = '';
        if (val.length < 2) { resultados.style.display = 'none'; return; }
        
        const filtrados = datosMedidores.filter(f => 
            String(f.properties.Ubicacion || "").toLowerCase().includes(val) || 
            String(f.properties.Domicilio || "").toLowerCase().includes(val) || 
            String(f.properties.Cuenta || "").includes(val)
        ).slice(0, 5);

        if (filtrados.length > 0) {
            filtrados.forEach(f => {
                const div = document.createElement('div');
                div.className = 'resultado-item';
                const direccion = extraerDireccion(f.properties);
                div.innerText = `${direccion} (Cuenta: ${f.properties.Cuenta})`;
                div.onclick = () => {
                    map.setView([f.geometry.coordinates[1], f.geometry.coordinates[0]], 18);
                    mostrarFicha(f.properties);
                    resultados.style.display = 'none';
                    input.value = direccion;
                    input.blur(); 
                };
                resultados.appendChild(div);
            });
            resultados.style.display = 'block';
        } else { resultados.style.display = 'none'; }
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !resultados.contains(e.target)) {
            resultados.style.display = 'none';
        }
    });
}

// ==========================================
// 4. FICHA DE MEDIDOR Y LOGICA DE DATOS
// ==========================================
function mostrarFicha(prop) {
    document.getElementById('ficha-medidor').style.display = 'block';
    const idCuenta = String(prop.Cuenta).trim();
    cuentaSeleccionadaTexto = idCuenta + " - " + extraerDireccion(prop);
    
    document.getElementById('titulo-medidor').innerText = "Cuenta: " + idCuenta;
    document.getElementById('info-domicilio').innerText = extraerDireccion(prop);
    
    const periodoSeleccionado = document.getElementById('select-periodo').value;
    const [cuotaActiva, anioActivo] = periodoSeleccionado.split('|');

    const registrosIndiv = todasLasLecturas.filter(p => String(p.Padron).trim() === idCuenta);
    const registroMesActivo = registrosIndiv.find(r => String(r["Liq-Cuota"]) === cuotaActiva && String(r[buscarClaveAnio(r)]) === anioActivo);

    const bloqueObs = document.getElementById('bloque-observacion');
    const lblObs = document.getElementById('lbl-observacion');

    if (registroMesActivo) {
        document.getElementById('lbl-medidor').innerText = registroMesActivo["Nro-Medidor"] || 'S/D';
        document.getElementById('lbl-lectura').innerText = registroMesActivo.Lectura ? parseInt(registroMesActivo.Lectura).toLocaleString() + " kWh" : '0';
        document.getElementById('lbl-consumo').innerText = registroMesActivo.Consumo ? parseInt(registroMesActivo.Consumo).toLocaleString() + " kWh" : '0 kWh';
        document.getElementById('lbl-periodo-nombre').innerText = formatearPeriodoISO(cuotaActiva, anioActivo);
    } else {
        document.getElementById('lbl-medidor').innerText = 'Sin registro';
        document.getElementById('lbl-lectura').innerText = '-';
        document.getElementById('lbl-consumo').innerText = '-';
        document.getElementById('lbl-periodo-nombre').innerText = 'No liquidado';
    }

    const claveObservac = Object.keys(prop).find(k => k.toLowerCase().trim() === "observac");
    const valorObservac = claveObservac ? prop[claveObservac] : null;

    if (valorObservac && String(valorObservac).trim() !== "" && String(valorObservac).trim() !== "0" && String(valorObservac).toLowerCase().trim() !== "null") {
        lblObs.innerText = String(valorObservac).trim();
        bloqueObs.style.display = 'block'; 
    } else {
        bloqueObs.style.display = 'none';  
    }

    if (registrosIndiv.length === 0) {
        if (miGrafico) miGrafico.destroy();
        document.getElementById('indicador-tendencia').innerHTML = '';
        ultimoLabels = [];
        ultimoDatos = [];
        return;
    }

    registrosIndiv.sort((a, b) => {
        const keyA = buscarClaveAnio(a);
        return a[keyA] - b[keyA] || a["Liq-Cuota"] - b["Liq-Cuota"];
    });

    const el = document.getElementById('indicador-tendencia');
    if (registrosIndiv.length >= 2) {
        const indexActivo = registrosIndiv.findIndex(r => String(r["Liq-Cuota"]) === cuotaActiva && String(r[buscarClaveAnio(r)]) === anioActivo);
        
        if (indexActivo > 0) {
            const filaActiva = registrosIndiv[indexActivo];
            const filaAnterior = registrosIndiv[indexActivo - 1];

            const medidorActivoStr = String(filaActiva["Nro-Medidor"] || "").trim();
            const medidorAnteriorStr = String(filaAnterior["Nro-Medidor"] || "").trim();

            if (medidorActivoStr !== "" && medidorAnteriorStr !== "" && medidorActivoStr !== medidorAnteriorStr) {
                el.innerHTML = `<span style="color:#2c3e50; background:#ffffff; font-weight:bold; font-size:10px; padding:2px 6px; border-radius:3px; border:1px solid #fbf2db;">🔄 [Recambio Medidor]</span>`;
            } else {
                const ultimo = filaActiva.Consumo || 0;
                const anterior = filaAnterior.Consumo || 0;
                const diff = (((ultimo - anterior) / (anterior || 1)) * 100).toFixed(1);
                if (ultimo >= anterior) {
                    el.innerHTML = `<span style="color:#e74c3c; font-weight:bold; margin-left: 8px;">▲ +${diff}%</span>`;
                } else {
                    el.innerHTML = `<span style="color:#27ae60; font-weight:bold; margin-left: 8px;">▼ ${diff}%</span>`;
                }
            }
        } else {
            el.innerHTML = '';
        }
    } else {
        el.innerHTML = '';
    }

    ultimoLabels = registrosIndiv.map(r => {
        const mesAnio = `${r["Liq-Cuota"]}/${String(r[buscarClaveAnio(r)] || "").slice(-2)}`;
        const medidorCorto = r["Nro-Medidor"] ? `(M: ${r["Nro-Medidor"]})` : '(S/M)';
        return `${mesAnio} ${medidorCorto}`;
    });
    ultimoDatos = registrosIndiv.map(r => r.Consumo);
    
    dibujarGrafico(ultimoLabels, ultimoDatos);
}

function dibujarGrafico(labels, datos) {
    const ctx = document.getElementById('graficoMediciones').getContext('2d');
    if (miGrafico) miGrafico.destroy();
    Chart.register(ChartDataLabels);

    const maxVal = Math.max(...datos, 10);
    miGrafico = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: datos,
                backgroundColor: 'rgba(52, 152, 219, 0.75)',
                borderColor: '#2980b9',
                borderWidth: 1,
                borderRadius: 4,
                datalabels: { anchor: 'end', align: 'top', font: { size: 9, weight: 'bold' }, color: '#2c3e50' }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, datalabels: { display: true } },
            scales: {
                y: { beginAtZero: true, suggestedMax: maxVal + (maxVal * 0.3), grid: { display: false }, ticks: { display: false } },
                x: { grid: { display: false }, ticks: { font: { size: 8 } } }
            }
        }
    });
}

// ==========================================
// FUNCIONES PARA EL GRÁFICO MAXI CENTRADO (CON REPLICA DE DATOS)
// ==========================================
function abrirMaxiGrafico() {
    if (!ultimoLabels || ultimoLabels.length === 0) return; 
    
    document.getElementById('modal-grafico-maxi').style.display = 'flex';
    
    // Réplica exacta de textos e indicadores
    document.getElementById('titulo-grafico-maxi').innerText = document.getElementById('titulo-medidor').innerText;
    document.getElementById('subtitulo-grafico-maxi').innerText = document.getElementById('info-domicilio').innerText;
    document.getElementById('indicador-tendencia-maxi').innerHTML = document.getElementById('indicador-tendencia').innerHTML;
    
    // Réplica exacta de datos técnicos
    document.getElementById('lbl-medidor-maxi').innerText = document.getElementById('lbl-medidor').innerText;
    document.getElementById('lbl-lectura-maxi').innerText = document.getElementById('lbl-lectura').innerText;
    document.getElementById('lbl-consumo-maxi').innerText = document.getElementById('lbl-consumo').innerText;
    document.getElementById('lbl-periodo-nombre-maxi').innerText = document.getElementById('lbl-periodo-nombre').innerText;
    
    // Réplica de bloque de observaciones si existieran
    const obsOrigen = document.getElementById('bloque-observacion');
    const obsDestino = document.getElementById('bloque-observacion-maxi');
    if(obsOrigen.style.display === 'block') {
        document.getElementById('lbl-observacion-maxi').innerText = document.getElementById('lbl-observacion').innerText;
        obsDestino.style.display = 'block';
    } else {
        obsDestino.style.display = 'none';
    }

    const ctxMaxi = document.getElementById('canvasGraficoMaxi').getContext('2d');
    if (miGraficoMaxi) miGraficoMaxi.destroy();

    const maxVal = Math.max(...ultimoDatos, 10);
    
    miGraficoMaxi = new Chart(ctxMaxi, {
        type: 'bar',
        data: {
            labels: ultimoLabels,
            datasets: [{
                label: 'Consumo Mensual (kWh)',
                data: ultimoDatos,
                backgroundColor: 'rgba(41, 128, 185, 0.8)',
                borderColor: '#2980b9',
                borderWidth: 1.5,
                borderRadius: 6,
                datalabels: { 
                    anchor: 'end', 
                    align: 'top', 
                    font: { size: 11, weight: 'bold' }, 
                    color: '#2c3e50',
                    formatter: function(value) { return parseInt(value || 0).toLocaleString() + " kWh"; }
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { display: false }, 
                datalabels: { display: true } 
            },
            scales: {
                y: { 
                    beginAtZero: true, 
                    suggestedMax: maxVal + (maxVal * 0.25), 
                    grid: { color: '#f2f4f4' }, 
                    ticks: { font: { size: 10 }, color: '#7f8c8d' } 
                },
                x: { 
                    grid: { display: false }, 
                    ticks: { font: { size: 10, weight: '600' }, color: '#34495e' } 
                }
            }
        }
    });
}

function cerrarMaxiGrafico() {
    document.getElementById('modal-grafico-maxi').style.display = 'none';
    if (miGraficoMaxi) {
        miGraficoMaxi.destroy();
        miGraficoMaxi = null;
    }
}

// ==========================================
// 5. VISTAS PREVIAS Y EXPORTACIÓN A PDF
// ==========================================
function verVistaPrevia() {
    const periodo = document.getElementById('select-periodo').value;
    if (!periodo) return;
    const [cuota, anio] = periodo.split('|');
    const soloMunicipales = document.getElementById('chk-reporte-municipal').checked;

    let filtrados = todasLasLecturas.filter(r => String(r["Liq-Cuota"]) === cuota && String(r[buscarClaveAnio(r)]) === anio);
    
    if (soloMunicipales) {
        filtrados = filtrados.filter(r => String(r["Dep-Munic"]).toUpperCase() === "SI");
    }

    const formatoMesLabel = formatearPeriodoISO(cuota, anio);

    const mapaDireccionesMedidores = {};
    datosMedidores.forEach(f => {
        if(f.properties && f.properties.Cuenta) {
            mapaDireccionesMedidores[String(f.properties.Cuenta).trim()] = f.properties;
        }
    });

    const subTituloFiltro = soloMunicipales ? " (MUNICIPALES)" : "";
    document.getElementById('preview-titulo').innerText = `Período ${formatoMesLabel}${subTituloFiltro}`;
    document.getElementById('resumen-texto').innerText = `Total de medidores: ${filtrados.length}`;

    let htmlTabla = `<table class="tabla-preview" id="tabla-exportar">
        <thead>
            <tr>
                <th>Padrón</th>
                <th>Ubicación / Domicilio</th>
                <th>Nro. Medidor</th>
                <th>Fecha</th>
                <th>Lectura</th>
                <th style="text-align:right;">Consumo (kWh)</th>
            </tr>
        </thead>
        <tbody>`;

    let totalConsumo = 0;
    filtrados.forEach(r => {
        totalConsumo += parseFloat(r.Consumo || 0);
        const idPadron = String(r.Padron).trim();
        const medidorEncontrado = mapaDireccionesMedidores[idPadron];
        const direccionFinal = r.Ubicacion || r.Domicilio || extraerDireccion(medidorEncontrado);

        htmlTabla += `<tr>
            <td>${r.Padron}</td>
            <td>${direccionFinal}</td>
            <td>${r["Nro-Medidor"] || 'S/D'}</td>
            <td>${r.Fecha || 'S/D'}</td>
            <td>${r.Lectura || 0}</td>
            <td style="text-align:right; font-weight:bold;">${r.Consumo || 0}</td>
        </tr>`;
    });

    htmlTabla += `<tr class="total-row">
        <td colspan="5">TOTAL CONSUMO ENERGÉTICO</td>
        <td style="text-align:right;">${totalConsumo.toLocaleString()} kWh</td>
    </tr></tbody></table>`;

    document.getElementById('preview-tabla-container').innerHTML = htmlTabla;
    document.getElementById('modal-reporte').style.display = 'flex';

    document.getElementById('btn-descarga-final').onclick = () => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.setFontSize(15);
        doc.text(`Reporte Mensual - Periodo ${formatoMesLabel}`, 14, 20);
        doc.setFontSize(10);
        doc.text(`Consumo Consolidado${subTituloFiltro}: ${totalConsumo.toLocaleString()} kWh`, 14, 27);
        doc.autoTable({ html: '#tabla-exportar', startY: 35, theme: 'striped', headStyles: { fillColor: [44, 62, 80] } });
        doc.save(`Reporte_Mensual_${formatoMesLabel}.pdf`);
    };
}

function verVistaPreviaGeneral() {
    const soloMunicipales = document.getElementById('chk-reporte-municipal').checked;
    
    let lecturasAProcesar = todasLasLecturas;
    if (soloMunicipales) {
        lecturasAProcesar = todasLasLecturas.filter(r => String(r["Dep-Munic"]).toUpperCase() === "SI");
    }

    const mapaMesesExistentes = {};
    let totalGlobalConsumo = 0;

    lecturasAProcesar.forEach(r => {
        const keyAnio = buscarClaveAnio(r);
        const mLabel = formatearPeriodoISO(r["Liq-Cuota"], r[keyAnio]);
        mapaMesesExistentes[mLabel] = { cuota: r["Liq-Cuota"], anio: r[keyAnio] };
        totalGlobalConsumo += parseFloat(r.Consumo || 0);
    });

    const listaMesesColumnas = Object.keys(mapaMesesExistentes).sort((a,b) => {
        const [anioA, mesA] = a.split('-').map(Number);
        const [anioB, mesB] = b.split('-').map(Number);
        return anioA - anioB || mesA - mesB;
    });

    const matrizMedidores = {};

    lecturasAProcesar.forEach(r => {
        const idPadron = String(r.Padron).trim();
        const keyAnio = buscarClaveAnio(r);
        const mLabel = formatearPeriodoISO(r["Liq-Cuota"], r[keyAnio]);
        const consumoVal = parseFloat(r.Consumo || 0);

        if (!matrizMedidores[idPadron]) {
            matrizMedidores[idPadron] = {
                padron: idPadron,
                direccion: r.Ubicacion || r.Domicilio || 'S/D',
                medidor: r["Nro-Medidor"] || 'S/D',
                valoresMes: {}
            };
        }
        matrizMedidores[idPadron].valoresMes[mLabel] = (matrizMedidores[idPadron].valoresMes[mLabel] || 0) + consumoVal;
    });

    datosMedidores.forEach(f => {
        const idCuenta = String(f.properties.Cuenta).trim();
        if (matrizMedidores[idCuenta] && matrizMedidores[idCuenta].direccion === 'S/D') {
            matrizMedidores[idCuenta].direccion = extraerDireccion(f.properties);
        }
    });

    const medidoresLista = Object.values(matrizMedidores);

    const tagTitulo = soloMunicipales ? "MUNICIPAL: " : "GLOBAL: ";
    document.getElementById('preview-titulo').innerText = `TOTAL ${tagTitulo}${totalGlobalConsumo.toLocaleString()} kWh`;
    document.getElementById('resumen-texto').innerText = `Matriz Mensual por Cuenta. Deslice horizontalmente para ver todos los meses.`;

    let htmlTabla = `<table class="tabla-preview" id="tabla-exportar">
        <thead>
            <tr>
                <th>Padrón</th>
                <th>Domicilio</th>
                <th>Medidor</th>`;
    
    listaMesesColumnas.forEach(mesCol => {
        htmlTabla += `<th style="text-align:right;">${mesCol}</th>`;
    });
    htmlTabla += `<th style="text-align:right; background-color:#16a085; color:white;">TOTAL</th></tr></thead><tbody>`;

    const totalesPorMesCol = {};
    listaMesesColumnas.forEach(m => totalesPorMesCol[m] = 0);

    medidoresLista.forEach(m => {
        htmlTabla += `<tr>
            <td><strong>${m.padron}</strong></td>
            <td>${m.direccion}</td>
            <td>${m.medidor}</td>`;
        
        let sumaFilaAcumulada = 0;
        
        listaMesesColumnas.forEach(mesCol => {
            const consumoCelda = m.valoresMes[mesCol] || 0;
            sumaFilaAcumulada += consumoCelda;
            totalesPorMesCol[mesCol] += consumoCelda;
            
            htmlTabla += `<td style="text-align:right;">${consumoCelda > 0 ? consumoCelda.toLocaleString() : '-'}</td>`;
        });

        htmlTabla += `<td style="text-align:right; font-weight:bold; background:#ffffff;">${sumaFilaAcumulada.toLocaleString()}</td></tr>`;
    });

    htmlTabla += `<tr class="total-row">
        <td colspan="3" style="text-align:right;">TOTALES:</td>`;
    
    listaMesesColumnas.forEach(mesCol => {
        htmlTabla += `<td style="text-align:right;">${totalesPorMesCol[mesCol].toLocaleString()}</td>`;
    });
    
    htmlTabla += `<td style="text-align:right; background-color:#2c3e50; color:white;">${totalGlobalConsumo.toLocaleString()}</td></tr></tbody></table>`;

    document.getElementById('preview-tabla-container').innerHTML = htmlTabla;
    document.getElementById('modal-reporte').style.display = 'flex';

    document.getElementById('btn-descarga-final').onclick = () => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });
        doc.setFontSize(14);
        doc.text(`TOTAL ${tagTitulo}${totalGlobalConsumo.toLocaleString()} kWh`, 14, 15);
        doc.autoTable({ 
            html: '#tabla-exportar', 
            startY: 22, 
            theme: 'grid', 
            styles: { fontSize: 8, cellPadding: 2 }
        });
        doc.save(`Matriz_Historica.pdf`);
    };
}

function cerrarModal() {
    document.getElementById('modal-reporte').style.display = 'none';
}