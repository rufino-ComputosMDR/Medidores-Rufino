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

// 1. CARGA INICIAL COMPLETA CON CRUCE DE ATRIBUTOS
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

// 2. REFRESCAR PUNTOS EN EL MAPA
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

    capaPuntosMapa = L.geoJSON({ type: "FeatureCollection", features: medidoresAFiltrar }, {
        pointToLayer: (feature, latlng) => {
            const idCuenta = String(feature.properties.Cuenta).trim();
            const lecturaAsociada = mapaLecturasRapido[idCuenta];
            const consumoMes = lecturaAsociada ? parseFloat(lecturaAsociada.Consumo || 0) : 0;
            const esTop10 = consumoMes >= limiteTop10Mes && consumoMes > 0;
            
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
    });

    capaPuntosMapa.addTo(map);
}

// 3. CONFIGURACIÓN DEL BUSCADOR
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
}

// 4. MOSTRAR FICHA LATERAL / BOTTOM SHEET
function mostrarFicha(prop) {
    document.getElementById('ficha-medidor').style.display = 'block';
    const idCuenta = String(prop.Cuenta).trim();
    
    document.getElementById('titulo-medidor').innerText = "Cuenta: " + idCuenta;
    document.getElementById('info-domicilio').innerText = extraerDireccion(prop);
    
    const periodoSeleccionado = document.getElementById('select-periodo').value;
    const [cuotaActiva, anioActivo] = periodoSeleccionado.split('|');

    const registrosIndiv = todasLasLecturas.filter(p => String(p.Padron).trim() === idCuenta);
    const registroMesActivo = registrosIndiv.find(r => String(r["Liq-Cuota"]) === cuotaActiva && String(r[buscarClaveAnio(r)]) === anioActivo);

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

    if (registrosIndiv.length === 0) {
        if (miGrafico) miGrafico.destroy();
        document.getElementById('indicador-tendencia').innerHTML = '';
        return;
    }

    registrosIndiv.sort((a, b) => {
        const keyA = buscarClaveAnio(a);
        return a[keyA] - b[keyA] || a["Liq-Cuota"] - b["Liq-Cuota"];
    });

    if (registrosIndiv.length >= 2) {
        const ultimo = registrosIndiv[registrosIndiv.length - 1].Consumo;
        const anterior = registrosIndiv[registrosIndiv.length - 2].Consumo;
        const diff = (((ultimo - anterior) / (anterior || 1)) * 100).toFixed(1);
        const el = document.getElementById('indicador-tendencia');
        if (ultimo >= anterior) {
            el.innerHTML = `<span style="color:#e74c3c; font-weight:bold;">▲ +${diff}%</span>`;
        } else {
            el.innerHTML = `<span style="color:#27ae60; font-weight:bold;">▼ ${diff}%</span>`;
        }
    } else {
        document.getElementById('indicador-tendencia').innerHTML = '';
    }

    const etiquetas = registrosIndiv.map(r => `${r["Liq-Cuota"]}/${String(r[buscarClaveAnio(r)] || "").slice(-2)}`);
    const consumos = registrosIndiv.map(r => r.Consumo);
    dibujarGrafico(etiquetas, consumos);
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
                backgroundColor: 'rgba(93, 173, 226, 0.7)',
                borderColor: '#5dade2',
                borderWidth: 1,
                borderRadius: 4,
                datalabels: { anchor: 'end', align: 'top', font: { size: 9, weight: 'bold' }, color: '#2e86c1' }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, datalabels: { display: true } },
            scales: {
                y: { beginAtZero: true, suggestedMax: maxVal + (maxVal * 0.3), grid: { display: false }, ticks: { display: false } },
                x: { grid: { display: false }, ticks: { font: { size: 9 } } }
            }
        }
    });
}

// ==========================================
// 5. GENERACIÓN DE REPORTES EN MODAL Y PDF
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
    document.getElementById('modal-reporte').style.display = 'block';

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

        htmlTabla += `<td class="col-total">${sumaFilaAcumulada.toLocaleString()}</td></tr>`;
    });

    htmlTabla += `<tr class="total-row">
        <td colspan="3" style="text-align:right;">TOTALES:</td>`;
    
    listaMesesColumnas.forEach(mesCol => {
        htmlTabla += `<td style="text-align:right;">${totalesPorMesCol[mesCol].toLocaleString()}</td>`;
    });
    
    htmlTabla += `<td style="text-align:right; background-color:#2c3e50; color:white;">${totalGlobalConsumo.toLocaleString()}</td></tr></tbody></table>`;

    document.getElementById('preview-tabla-container').innerHTML = htmlTabla;
    document.getElementById('modal-reporte').style.display = 'block';

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