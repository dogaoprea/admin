// --- CONFIGURAÇÃO FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyClYFGSNXxPmAn3DRWiB7eSxCQ3Nf81IHI", // <--- COLOQUE SUA NOVA CHAVE AQUI
    authDomain: "dogao-prea.firebaseapp.com",
    projectId: "dogao-prea",
    storageBucket: "dogao-prea.firebasestorage.app",
    messagingSenderId: "126231798500",
    appId: "1:126231798500:web:acbc4e4ef19b14d02082f1",
    measurementId: "G-40QL50Z24D"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const COL_ITEMS = 'menu_items';
const COL_SETTINGS = 'settings';
const COL_ORDERS = 'orders';

// Padrão
const defaultCategories = [
    { id: 'especiais', label: 'Favoritos' },
    { id: 'sanduiches', label: 'Sanduíches' },
    { id: 'hotdogs', label: 'Hot Dogs' },
    { id: 'pasteis', label: 'Pastéis' },
    { id: 'porcoes', label: 'Porções' },
    { id: 'bebidas', label: 'Bebidas' }
];

let categoriesConfig = JSON.parse(JSON.stringify(defaultCategories));

let currentItems = [];
let editingOrderCart = [];

let allOrders = []; 
let currentFilter = 'all'; 
let currentItemOptions = [];

// --- AUTH SEGURA ---
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('login-overlay').style.display = 'none';
        document.getElementById('app-content').style.display = 'block';
        document.getElementById('user-display').innerText = user.email;
        loadData(); 
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-content').style.display = 'none';
    }
});

function performFirebaseLogin() {
    const email = document.getElementById('admin-email').value;
    const pass = document.getElementById('admin-pass').value;
    const errorMsg = document.getElementById('login-error');

    if(!email || !pass) {
        errorMsg.innerText = "Preencha e-mail e senha.";
        errorMsg.style.display = 'block';
        return;
    }
    
    auth.signInWithEmailAndPassword(email, pass)
        .catch((error) => {
            console.error(error);
            let msg = "Erro ao entrar.";
            if(error.code === 'auth/wrong-password') msg = "Senha incorreta.";
            if(error.code === 'auth/user-not-found') msg = "Usuário não cadastrado.";
            if(error.code === 'auth/invalid-email') msg = "E-mail inválido.";
            errorMsg.innerText = msg;
            errorMsg.style.display = 'block';
        });
}

function performLogout() { 
    if(confirm("Sair do painel?")) {
        auth.signOut();
    }
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tabId).classList.add('active');
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    event.currentTarget.classList.add('active');
    if(tabId === 'history') renderHistoryList();
}

function loadData() {
    db.collection(COL_SETTINGS).doc('store').onSnapshot(doc => {
        if(doc.exists) {
            const d = doc.data();
            updateStatusText(d);
        }
    });

    db.collection(COL_SETTINGS).doc('categories').onSnapshot(doc => {
        if (doc.exists && doc.data().list) categoriesConfig = doc.data().list;
        updateCategorySelect(); renderList();
    });

    db.collection(COL_ITEMS).onSnapshot(snap => {
        currentItems = [];
        snap.forEach(doc => currentItems.push({id: doc.id, ...doc.data()}));
        renderList();
    });

    db.collection(COL_ORDERS).orderBy('timestamp', 'desc').limit(300).onSnapshot(snap => {
        allOrders = [];
        snap.forEach(doc => allOrders.push({ _id: doc.id, ...doc.data() }));
        renderOrders(); 
        if(document.getElementById('tab-history').classList.contains('active')) renderHistoryList();
        updateCustomerSuggestions(); 
    });
}

function updateCustomerSuggestions() {
    const namesSet = new Set();
    allOrders.forEach(o => {
        if(o.customerName) namesSet.add(o.customerName);
    });
    const datalist = document.getElementById('customer-suggestions');
    datalist.innerHTML = '';
    Array.from(namesSet).sort().forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        datalist.appendChild(opt);
    });
}

function checkCustomerAddress(name) {
        if (!name) return;
        const lastOrder = allOrders.find(o => 
        o.customerName && o.customerName.toLowerCase() === name.toLowerCase()
        );
        if (lastOrder) {
            if(lastOrder.address) document.getElementById('edit-order-address').value = lastOrder.address;
            if(lastOrder.userPhone) document.getElementById('edit-order-phone').value = lastOrder.userPhone;
            if(lastOrder.deliveryFee) {
                document.getElementById('edit-order-fee').value = lastOrder.deliveryFee.toFixed(2);
                calculateOrderTotal();
                showToast("Dados do cliente encontrados!");
            }
        }
}

function filterOrders(filter, btn) {
    currentFilter = filter;
    renderOrders();
}

function renderOrders() {
    const activeContainer = document.getElementById('orders-list');
    activeContainer.innerHTML = '';
    let hasActive = false;

    allOrders.forEach(order => {
        const status = order.status || 'pending';
        const isFinished = status === 'done' || status === 'cancelled';
        if (isFinished) return; 

        hasActive = true;
        activeContainer.appendChild(createOrderCard(order, false));
    });

    if (!hasActive) activeContainer.innerHTML = '<p style="text-align: center; margin-top: 40px; color: #888;">Nenhum pedido aqui.</p>';
}

let historyRefDate = '';
function applyHistoryFilter() {
    historyRefDate = document.getElementById('filter-ref-date').value;
    if (!historyRefDate) { alert("Por favor, selecione uma data de referência."); return; }
    renderHistoryList();
}
function clearHistoryFilter() {
    document.getElementById('filter-ref-date').value = '';
    historyRefDate = '';
    renderHistoryList();
}

function renderHistoryList() {
    const container = document.getElementById('history-list-container');
    container.innerHTML = '';

    let filteredOrders = allOrders.filter(order => order.status === 'done' || order.status === 'cancelled');

    if (historyRefDate) {
        const start = new Date(historyRefDate + 'T18:00:00');
        const end = new Date(historyRefDate + 'T04:00:00');
        end.setDate(end.getDate() + 1);

        filteredOrders = filteredOrders.filter(order => {
            const d = order.timestamp ? new Date(order.timestamp.seconds * 1000) : new Date(0);
            return d >= start && d <= end;
        });
    }

    let totalRev = 0, totalFees = 0, count = 0;
    filteredOrders.forEach(o => {
        if(o.status === 'done') {
            totalRev += (o.total || 0);
            totalFees += (o.deliveryFee || 0);
            count++;
        }
    });
    
    document.getElementById('summary-total').innerText = `R$ ${totalRev.toFixed(2)}`;
    document.getElementById('summary-fees').innerText = `R$ ${totalFees.toFixed(2)}`;
    document.getElementById('summary-count').innerText = count;

    if (filteredOrders.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:#ccc;padding:20px;">Nenhum pedido encontrado neste período.</p>';
        return;
    }
    filteredOrders.forEach(order => container.appendChild(createOrderCard(order, true)));
}

function createOrderCard(order, isHistory) {
    const date = order.timestamp ? new Date(order.timestamp.seconds * 1000) : new Date();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = date.toLocaleDateString('pt-BR');
    const isNew = (new Date() - date) < 300000;
    const isPaid = order.isPaid === true || (order.status === 'done' && order.isPaid !== false);
    const isFinalized = order.status === 'done' || order.status === 'cancelled';
    
    let itemsHtml = '';
    if (order.cart) {
        itemsHtml = order.cart.map(i => {
            const total = (i.price || 0) * i.qty;
            let xtra = '';
            if (i.selectedOption) xtra += `<div class="order-extras-list">Opção: ${i.selectedOption}</div>`;
            if (i.obs) xtra += `<div style="font-size:11px;color:#666;font-style:italic;">Obs: ${i.obs}</div>`;
            return `<div class="order-item-line"><span>${i.qty}x ${i.name}</span><span>R$ ${total.toFixed(2)}</span></div>${xtra}`;
        }).join('');
    }

    const fee = order.deliveryFee || 0;
    const discount = order.discount || 0;
    const surcharge = order.surcharge || 0;
    const total = order.total || 0;

    let paymentInfoHtml = `<strong>Pagamento:</strong> ${order.payment}`;
    let changeValueHtml = ''; 

    if(order.payment === 'Dinheiro' && order.change) {
        const amountTendered = parseFloat(order.change);
        if (!isNaN(amountTendered)) {
            const tenderedFmt = amountTendered.toFixed(2).replace('.', ',');
            paymentInfoHtml += ` (Para: R$ ${tenderedFmt})`;

            const changeNeeded = amountTendered - total;
            if (changeNeeded > 0) {
                const changeNeededFmt = changeNeeded.toFixed(2).replace('.', ',');
                changeValueHtml = `<small style="font-weight:700;color:var(--success);">Troco: R$ ${changeNeededFmt}</small><br>`;
            }
        }
    }

    const clientWaLink = order.userPhone ? 
        `<a href="https://wa.me/55${order.userPhone}" target="_blank" style="margin-left:5px; color:#25D366; text-decoration:none;"><i class="fab fa-whatsapp"></i></a>` : '';

    let statusOpts = `
        <option value="pending" ${order.status==='pending'?'selected':''}>Pendente</option>
        <option value="confirmed" ${order.status==='confirmed'?'selected':''}>Confirmado</option>
        <option value="delivering" ${order.status==='delivering'?'selected':''}>Saiu p/ Entrega</option>
        <option value="ready" ${order.status==='ready'?'selected':''}>Pronto p/ Retirada</option>
        <option value="done" ${order.status==='done'?'selected':''}>Concluído</option>
        <option value="cancelled" ${order.status==='cancelled'?'selected':''}>Cancelado</option>
    `;
    
    const actions = isHistory ? 
        `<button class="btn-sm btn-reopen" style="background:#FF9800;margin-right:5px;" onclick="reopenOrder('${order._id}')" title="Reabrir Pedido"><i class="fas fa-undo"></i></button>
            <button class="btn-sm btn-delete-forever" onclick="deleteOrderForever('${order._id}')" title="Apagar"><i class="fas fa-trash"></i></button>` :
        `<button class="btn-sm btn-copy" onclick="copyToClipboard(this, \`${getTextClipboard(order)}\`)"><i class="far fa-copy"></i></button>
            <a href="https://wa.me/?text=${encodeURIComponent(getTextClipboard(order))}" target="_blank" class="btn-sm btn-share"><i class="fab fa-whatsapp"></i></a>
            <button class="btn-sm btn-edit-order" onclick="openOrderEditModal('${order._id}')"><i class="fas fa-pencil-alt"></i></button>`;

    const payBtnClass = isPaid ? 'btn-pay-paid' : 'btn-pay-pending';
    const payBtnText = isPaid ? `<i class="fas fa-check-circle"></i> PAGO` : `<i class="fas fa-clock"></i> PENDENTE`;
    
    let payToggleButton;
    if (isFinalized) {
        payToggleButton = `<button class="btn-pay-status ${payBtnClass}" style="opacity:0.6; cursor:not-allowed; pointer-events:none; margin:0;">${payBtnText}</button>`;
    } else {
        payToggleButton = `<button class="btn-pay-status ${payBtnClass}" style="margin:0;" onclick="toggleOrderPaid('${order._id}', ${isPaid})">${payBtnText}</button>`;
    }

    const card = document.createElement('div');
    card.className = `order-card ${isNew ? 'new' : ''} status-${order.status || 'pending'}`;
    
    const statusAndPaymentRow = `
        <div style="display:flex; gap:10px; align-items:center; margin-top:10px;">
            ${!isHistory ? `<select class="status-select" style="margin-top:0; flex:1;" onchange="updateOrderStatus('${order._id}', this.value, '${order.customerName}', '${order.userPhone||''}')">${statusOpts}</select>` : ''}
            <div style="flex-shrink:0;">${payToggleButton}</div>
        </div>
    `;

    card.innerHTML = `
        <div class="order-header">
            <div>
                <span class="order-id">#${order.orderId||'???'}</span>
                <span class="order-time" style="font-weight:500; font-size:12px; color:#666;">
                    <i class="far fa-calendar-alt"></i> ${dateStr} &nbsp; ${timeStr}
                </span>
            </div>
            <div class="btn-action-group">${actions}</div>
        </div>
        <div class="order-info">
            <p><strong>Cliente:</strong> ${order.customerName} ${clientWaLink}</p>
            <p><strong>Tipo:</strong> ${order.type} ${order.pickupTime ? `(${order.pickupTime})` : ''}</p>
            <p>${paymentInfoHtml}</p>
            ${order.address ? `<p><strong>Endereço:</strong> <span style="font-size:13px;color:#555;">${order.address}</span></p>` : ''}
            ${order.mapsLink ? `<p><a href="${order.mapsLink}" target="_blank" style="color:var(--primary); text-decoration:none; font-weight:600;"><i class="fas fa-map-marker-alt"></i> Ver no Mapa</a></p>` : ''}
        </div>
        <div class="order-items">${itemsHtml}</div>
        
        ${statusAndPaymentRow}
        
        <div class="order-total" style="margin-top:10px;">
            ${fee>0 ? `<small style="font-weight:400;color:#666;">Taxa: R$ ${fee.toFixed(2)}</small><br>` : ''}
            ${surcharge>0 ? `<small style="font-weight:400;color:var(--info);">Acréscimo: + R$ ${surcharge.toFixed(2)}</small><br>` : ''}
            ${discount>0 ? `<small style="font-weight:400;color:var(--danger);">Desconto: - R$ ${discount.toFixed(2)}</small><br>` : ''}
            ${changeValueHtml}
            Total: R$ ${total.toFixed(2)}
        </div>
    `;
    return card;
}

function getTextClipboard(order) {
    const fee = order.deliveryFee || 0;
    const surcharge = order.surcharge || 0;
    const discount = order.discount || 0;
    const total = order.total || 0;
    const isPaid = order.isPaid === true || (order.status === 'done' && order.isPaid !== false);
    const paymentStatusText = isPaid ? '✅ PAGO' : '❌ A PAGAR';
    
    const date = order.timestamp ? new Date(order.timestamp.seconds * 1000) : new Date();
    const dateStr = date.toLocaleDateString('pt-BR');
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let paymentInfo = `${order.payment} (${paymentStatusText})`;
    if(order.payment === 'Dinheiro' && order.change) {
        const amountTendered = parseFloat(order.change);
        if(!isNaN(amountTendered)) {
            const changeNeeded = amountTendered - total;
            paymentInfo += ` -> Para: R$ ${amountTendered.toFixed(2)}`;
            if(changeNeeded > 0) {
                paymentInfo += ` (Troco: R$ ${changeNeeded.toFixed(2)})`;
            }
        }
    }

    let cleanPhone = order.userPhone || '';
    if(cleanPhone.startsWith('55') && cleanPhone.length > 10) {
        cleanPhone = cleanPhone.substring(2);
    }

    const typeEmojis = { 'Entrega': '🛵', 'Mesa': '🍽️', 'Retirada': '📦' };
    const typeIcon = typeEmojis[order.type] || '🛍️';

    let t = `*PEDIDO #${order.orderId || '???'}*\n`;
    t += `📅 ${dateStr} às ${timeStr}\n\n`;
    
    t += `👤 *Cliente:* ${order.customerName}\n`;
    if(cleanPhone) t += `📱 *WhatsApp:* ${cleanPhone}\n`;
    
    t += `${typeIcon} *Tipo:* ${order.type}\n`;
    t += `📍 *Endereço:* ${order.address || 'Não informado'}\n`;
    t += `💰 *Pagamento:* ${paymentInfo}\n`;
    t += `\n*ITENS DO PEDIDO:*\n--------------------------------\n`;
    
    if (order.cart) {
        t += order.cart.map(i => {
            const itemTotal = (i.price || 0) * i.qty;
            let l = `${i.qty}x ${i.name} (R$ ${itemTotal.toFixed(2)})`;
            if(i.selectedOption) l+= `\n   + ${i.selectedOption}`;
            if(i.obs) l+= `\n   Obs: ${i.obs}`; 
            return l;
        }).join('\n\n');
    }
    t += `\n--------------------------------\n`;
    const sub = (order.cart||[]).reduce((a,i)=>a+(i.price*i.qty),0);
    t += `Subtotal: R$ ${sub.toFixed(2)}\n`;
    if(fee > 0) t += `Taxa Entrega: R$ ${fee.toFixed(2)}\n`;
    if(surcharge > 0) t += `Acréscimo: + R$ ${surcharge.toFixed(2)}\n`;
    if(discount > 0) t += `Desconto: - R$ ${discount.toFixed(2)}\n`;
    t += `\n*TOTAL FINAL: R$ ${total.toFixed(2)}*`;
    if(order.mapsLink) t += `\n\n🗺️ Link Maps: ${order.mapsLink}`;

    return t;
}

function updateOrderStatus(docId, newStatus, customerName, customerPhone) {
    const updateData = { status: newStatus };
    if (newStatus === 'done') { updateData.isPaid = true; }
    db.collection(COL_ORDERS).doc(docId).update(updateData).then(() => {
        showToast("Atualizado!");
        if ((newStatus === 'delivering' || newStatus === 'ready') && customerPhone) {
            const msg = newStatus === 'delivering' ? 
                `Olá ${customerName}! 🛵💨 Seu pedido saiu para entrega.` : 
                `Olá ${customerName}! 🍔🥡 Seu pedido está pronto para retirada.`;
            window.open(`https://wa.me/55${customerPhone}?text=${encodeURIComponent(msg)}`, '_blank');
        }
    });
}

function toggleOrderPaid(docId, currentStatus) {
    const newStatus = !currentStatus;
    db.collection(COL_ORDERS).doc(docId).update({ isPaid: newStatus })
        .then(() => showToast(newStatus ? "Marcado como PAGO" : "Marcado como A PAGAR"))
        .catch(e => alert("Erro: " + e.message));
}

function reopenOrder(docId) {
    if(confirm("Deseja reabrir este pedido? Ele voltará para a lista de Pendentes.")) {
        db.collection(COL_ORDERS).doc(docId).update({ status: 'pending' })
            .then(() => showToast("Pedido reaberto!"))
            .catch(e => alert("Erro: " + e.message));
    }
}

function copyToClipboard(btn, text) {
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text.replace(/`/g, '\\`');
        textarea.style.position = 'fixed'; 
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (successful) {
            const og = btn.innerHTML; 
            btn.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => btn.innerHTML = og, 1500);
        } else { alert("Erro ao copiar."); }
    } catch (err) { console.error('Fallback copy error', err); }
}

function deleteOrderForever(docId) { if(confirm("Apagar permanentemente?")) db.collection(COL_ORDERS).doc(docId).delete(); }

function openOrderEditModal(docId) {
    const isEdit = !!docId;
    document.getElementById('order-modal-title').innerText = isEdit ? "Editar Pedido" : "Novo Pedido";
    document.getElementById('auto-fee-toggle').checked = false;

    if (isEdit) {
        db.collection(COL_ORDERS).doc(docId).get().then(doc => {
            if (!doc.exists) return alert("Erro!");
            fillOrderModal(doc.id, doc.data());
        });
    } else {
        fillOrderModal(null, {
            customerName: '', userPhone: '', type: 'Entrega', payment: 'PIX', address: '',
            deliveryFee: 0, discount: 0, surcharge: 0, isPaid: false, cart: []
        });
    }
}

function fillOrderModal(docId, order) {
    document.getElementById('edit-order-doc-id').value = docId || '';
    document.getElementById('edit-order-name').value = order.customerName;
    document.getElementById('edit-order-phone').value = order.userPhone || '';
    document.getElementById('edit-order-type').value = order.type || 'Entrega';
    updateTypeBtnUI(); 
    document.getElementById('edit-order-payment').value = order.payment;
    document.getElementById('edit-order-address').value = order.address || '';
    document.getElementById('edit-order-fee').value = (order.deliveryFee > 0) ? order.deliveryFee.toFixed(2) : '';
    document.getElementById('edit-order-discount').value = (order.discount > 0) ? order.discount.toFixed(2) : '';
    document.getElementById('edit-order-surcharge').value = (order.surcharge > 0) ? order.surcharge.toFixed(2) : '';
    document.getElementById('edit-order-change').value = order.change || ''; 
    document.getElementById('edit-is-paid').checked = order.isPaid === true;
    editingOrderCart = (order.cart || []).map(i => ({ ...i, _uuid: i._uuid || Math.random() }));
    renderEditOrderItems();
    toggleChangeInput(); 
    document.getElementById('order-edit-modal').classList.add('open');
}

function closeOrderEditModal() { document.getElementById('order-edit-modal').classList.remove('open'); }

function cycleOrderType() {
    const types = ['Entrega', 'Retirada', 'Mesa'];
    const current = document.getElementById('edit-order-type').value || 'Entrega';
    let idx = types.indexOf(current);
    if (idx === -1) idx = 0;
    const next = types[(idx + 1) % types.length];
    document.getElementById('edit-order-type').value = next;
    updateTypeBtnUI();
}

function updateTypeBtnUI() {
    const val = document.getElementById('edit-order-type').value;
    const btn = document.getElementById('btn-order-type');
    const icons = { 'Entrega': 'fa-motorcycle', 'Retirada': 'fa-shopping-bag', 'Mesa': 'fa-chair' };
    const colors = { 'Entrega': '#ff9f1c', 'Retirada': '#2196F3', 'Mesa': '#4CAF50' };
    btn.innerHTML = `<i class="fas ${icons[val] || 'fa-question'}"></i>`;
    btn.style.background = colors[val] || '#ccc';
    btn.style.color = '#fff';
}

function openMenuSelectionModal() {
    const container = document.getElementById('menu-selection-list');
    container.innerHTML = '';
    const activeItems = currentItems.filter(i => i.available !== false);

    categoriesConfig.forEach(cat => {
        const items = activeItems.filter(i => i.category === cat.id);
        if (items.length) {
            items.sort((a,b) => a.name.localeCompare(b.name));
            container.innerHTML += `<div style="background:#f0f0f0; padding:8px 15px; font-weight:800; font-family:'Bebas Neue'; font-size:18px; color:#555; position:sticky; top:0;">${cat.label}</div>`;
            items.forEach(i => {
                container.innerHTML += `
                    <div onclick="selectMenuItem('${i.id}')" style="padding:15px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center; cursor:pointer; background:white;">
                        <span style="font-weight:600; font-size:15px;">${i.name}</span>
                        <span style="font-weight:700; color:var(--primary-dark);">R$ ${i.price.toFixed(2)}</span>
                    </div>
                `;
            });
        }
    });
    document.getElementById('menu-selection-modal').classList.add('open');
}
function closeMenuSelectionModal() { document.getElementById('menu-selection-modal').classList.remove('open'); }

function selectMenuItem(id) {
    const item = currentItems.find(i => i.id === id);
    if(item) {
        editingOrderCart.push({ id: item.id, name: item.name, price: item.price, qty: 1, obs: '', _uuid: Math.random() });
        renderEditOrderItems();
        showToast(`+1 ${item.name}`);
    }
}

function openCustomItemModal() {
    document.getElementById('custom-item-name').value = '';
    document.getElementById('custom-item-price').value = '';
    document.getElementById('custom-item-qty').value = '1';
    document.getElementById('custom-item-modal').classList.add('open');
}
function closeCustomItemModal() { document.getElementById('custom-item-modal').classList.remove('open'); }

function addCustomItemToOrder() {
    const n = document.getElementById('custom-item-name').value;
    const p = parseFloat(document.getElementById('custom-item-price').value);
    const q = parseInt(document.getElementById('custom-item-qty').value) || 1;
    if(!n || isNaN(p)) return alert("Preencha nome e preço.");
    editingOrderCart.push({ id: 'custom_'+Date.now(), name: n, price: p, qty: q, obs: 'Avulso', _uuid: Math.random() });
    renderEditOrderItems();
    closeCustomItemModal();
}

function openPaymentModal() {
    document.getElementById('payment-modal').classList.add('open');
    calculateOrderTotal(); 
}
function closePaymentModal() {
    document.getElementById('payment-modal').classList.remove('open');
    calculateOrderTotal(); 
}

function toggleChangeInput() {
    const p = document.getElementById('edit-order-payment').value;
    const div = document.getElementById('div-change-input');
    div.style.display = (p === 'Dinheiro') ? 'block' : 'none';
}

function renderEditOrderItems() {
    const list = document.getElementById('edit-order-items-list');
    list.innerHTML = '';
    editingOrderCart.forEach((item, index) => {
        list.innerHTML += `
            <div class="edit-order-item">
                <div class="edit-item-header">
                    <span>${item.name}</span>
                    <button style="color:var(--danger);background:none;border:none;" onclick="removeOrderItem(${index})"><i class="fas fa-trash"></i></button>
                </div>
                <div class="edit-item-body">
                    <div class="price-edit-group">
                        R$ <input type="number" step="0.50" class="price-edit-input" value="${item.price.toFixed(2)}" onfocus="this.select()" onchange="updateItemPrice(${index}, this.value)">
                    </div>
                    <div class="qty-edit-group">
                        <button class="btn-qty" onclick="updateOrderQty(${index}, -1)">-</button>
                        <span class="qty-val">${item.qty}</span>
                        <button class="btn-qty" onclick="updateOrderQty(${index}, 1)">+</button>
                    </div>
                </div>
                <div style="padding:0 15px 15px;">
                    <input type="text" class="form-input" style="font-size:12px;padding:8px;" placeholder="Obs (Ex: Sem cebola)" value="${item.obs || ''}" onchange="updateItemObs(${index}, this.value)">
                </div>
            </div>`;
    });
    calculateOrderTotal();
}

function updateItemObs(idx, val) { editingOrderCart[idx].obs = val; }
function updateItemPrice(idx, val) { 
    const p = parseFloat(val); 
    if(!isNaN(p) && p>=0) { editingOrderCart[idx].price = p; calculateOrderTotal(); }
}
function updateOrderQty(idx, chg) {
    editingOrderCart[idx].qty += chg;
    if(editingOrderCart[idx].qty <= 0) editingOrderCart.splice(idx, 1);
    renderEditOrderItems();
}
function removeOrderItem(idx) {
    if(confirm("Remover?")) { editingOrderCart.splice(idx, 1); renderEditOrderItems(); }
}

function calculateOrderTotal() {
    const sub = editingOrderCart.reduce((acc, i) => acc + (i.price * i.qty), 0);
    const isAutoOn = document.getElementById('auto-fee-toggle').checked;
    
    if (isAutoOn) {
        const method = document.getElementById('edit-order-payment').value;
        const feeVal = parseFloat(document.getElementById('edit-order-fee').value) || 0;
        const descVal = parseFloat(document.getElementById('edit-order-discount').value) || 0;
        const baseValue = sub + feeVal - descVal;
        let rate = 0;
        if (method === 'Cartão de Crédito') rate = 0.0498; 
        else if (method === 'Cartão de Débito') rate = 0.0199; 

        if (rate > 0 && baseValue > 0) {
            const finalValue = baseValue / (1 - rate);
            const necessarySurcharge = finalValue - baseValue;
            document.getElementById('edit-order-surcharge').value = necessarySurcharge.toFixed(2);
        } else {
            document.getElementById('edit-order-surcharge').value = '';
        }
    }

    const fee = parseFloat(document.getElementById('edit-order-fee').value) || 0;
    const desc = parseFloat(document.getElementById('edit-order-discount').value) || 0;
    const sur = parseFloat(document.getElementById('edit-order-surcharge').value) || 0;
    const total = Math.max(0, sub + fee + sur - desc);
    const totalFmt = `R$ ${total.toFixed(2)}`;
    
    document.getElementById('edit-order-subtotal').innerText = `R$ ${sub.toFixed(2)}`;
    document.getElementById('edit-order-total').innerText = totalFmt;
    
    const mainDisplay = document.getElementById('main-order-total-display');
    if(mainDisplay) mainDisplay.innerText = totalFmt;
    
    const method = document.getElementById('edit-order-payment').value;
    const methodDisplay = document.getElementById('main-payment-method-display');
    if(methodDisplay) methodDisplay.innerText = method;
}

function saveOrderChanges() {
    const docId = document.getElementById('edit-order-doc-id').value;
    const fee = parseFloat(document.getElementById('edit-order-fee').value) || 0;
    const desc = parseFloat(document.getElementById('edit-order-discount').value) || 0;
    const sur = parseFloat(document.getElementById('edit-order-surcharge').value) || 0;
    const isPaid = document.getElementById('edit-is-paid').checked;
    const sub = editingOrderCart.reduce((acc, i) => acc + (i.price * i.qty), 0);
    const total = Math.max(0, sub + fee + sur - desc);
    const changeVal = document.getElementById('edit-order-change').value;
    const typeVal = document.getElementById('edit-order-type').value;

    const data = {
        customerName: document.getElementById('edit-order-name').value,
        userPhone: document.getElementById('edit-order-phone').value,
        type: typeVal,
        payment: document.getElementById('edit-order-payment').value,
        address: document.getElementById('edit-order-address').value,
        cart: editingOrderCart,
        deliveryFee: fee, discount: desc, surcharge: sur, 
        isPaid: isPaid,
        total: total,
        change: changeVal
    };
    
    const p = docId ? db.collection(COL_ORDERS).doc(docId).update(data) : 
        db.collection(COL_ORDERS).add({
            ...data, 
            orderId: new Date().toLocaleTimeString('pt-BR',{hour12:false}).replace(/:/g,''),
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'pending'
        });
    
    p.then(() => { closeOrderEditModal(); showToast("Salvo!"); }).catch(e => alert(e));
}

function updateStatusText(d) {
    const manual = d.manualOverride;
    const open = d.isOpen;
    document.getElementById('manual-override').checked = manual;
    document.getElementById('store-toggle').checked = open;
    const controls = document.getElementById('manual-controls');
    controls.style.display = manual ? 'block' : 'none';
    const textEl = document.getElementById('status-text');
    if (manual) {
        textEl.innerText = open ? 'Aberto (Manual)' : 'Fechado (Manual)';
        textEl.style.color = open ? 'var(--success)' : 'var(--danger)';
    } else {
        textEl.innerText = 'Automático (Horário)';
        textEl.style.color = '#666';
    }
}

function renderList() {
    const list = document.getElementById('items-list');
    list.innerHTML = '';
    categoriesConfig.forEach(cat => {
        let items = currentItems.filter(i => i.category === cat.id);
        if(items.length) {
            items.sort((a,b) => a.name.localeCompare(b.name));
            list.innerHTML += `<div class="category-header">${cat.label}</div>`;
            items.forEach(i => {
                list.innerHTML += `
                    <div class="admin-item ${i.available===false?'unavailable':''}">
                        <div class="item-info">
                            <span class="item-name">${i.name}</span>
                            <span class="item-price">R$ ${i.price.toFixed(2)}</span>
                        </div>
                        <div>
                            <button class="btn btn-edit" onclick="openModal('${i.id}')"><i class="fas fa-pen"></i></button>
                            <button class="btn btn-delete" onclick="deleteItem('${i.id}')"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                `;
            });
        }
    });
}

function openModal(id) {
    const t = document.getElementById('item-modal');
    const i = id ? currentItems.find(x=>x.id===id) : {name:'',price:'',category:'sanduiches',desc:'',options:[],available:true};
    document.getElementById('edit-id').value = id||'';
    document.getElementById('edit-name').value = i.name;
    document.getElementById('edit-price').value = i.price;
    document.getElementById('edit-desc').value = i.desc;
    document.getElementById('edit-available').checked = i.available !== false;
    currentItemOptions = i.options || [];
    renderItemOptions();
    updateCategorySelect();
    document.getElementById('edit-category').value = i.category;
    t.classList.add('open');
}
function closeModal() { document.getElementById('item-modal').classList.remove('open'); }

function updateCategorySelect() {
    const s = document.getElementById('edit-category'); s.innerHTML = '';
    categoriesConfig.forEach(c => s.innerHTML += `<option value="${c.id}">${c.label}</option>`);
}

function addOptionToItem() {
    const v = document.getElementById('new-option-input').value;
    if(v) { currentItemOptions.push(v); document.getElementById('new-option-input').value=''; renderItemOptions(); }
}
function renderItemOptions() {
    document.getElementById('item-options-list').innerHTML = currentItemOptions.map((o,x) => 
        `<span style="background:#eee;padding:4px 8px;border-radius:12px;font-size:12px;">${o} <span onclick="currentItemOptions.splice(${x},1);renderItemOptions()" style="cursor:pointer;color:red;">&times;</span></span>`
    ).join('');
}

function saveItem() {
    const id = document.getElementById('edit-id').value;
    const d = {
        name: document.getElementById('edit-name').value,
        price: parseFloat(document.getElementById('edit-price').value),
        category: document.getElementById('edit-category').value,
        desc: document.getElementById('edit-desc').value,
        available: document.getElementById('edit-available').checked,
        options: currentItemOptions
    };
    const p = id ? db.collection(COL_ITEMS).doc(id).update(d) : db.collection(COL_ITEMS).add(d);
    p.then(()=>{ closeModal(); showToast("Item Salvo"); });
}
function deleteItem(id) { if(confirm("Excluir?")) db.collection(COL_ITEMS).doc(id).delete(); }

function openCategoryModal() {
    const c = document.getElementById('cat-list-container'); c.innerHTML='';
    categoriesConfig.forEach((cat, idx) => {
        c.innerHTML += `
        <div class="cat-edit-item">
            <button class="cat-move-btn" onclick="moveCategory(${idx},-1)">▲</button>
            <button class="cat-move-btn" onclick="moveCategory(${idx},1)">▼</button>
            <input class="form-input cat-lbl" value="${cat.label}" style="margin:0;">
        </div>`;
    });
    document.getElementById('cat-modal').classList.add('open');
}
function closeCategoryModal() { document.getElementById('cat-modal').classList.remove('open'); }
function moveCategory(i, d) {
    updateCatsTmp();
    if(i+d >= 0 && i+d < categoriesConfig.length) {
        [categoriesConfig[i], categoriesConfig[i+d]] = [categoriesConfig[i+d], categoriesConfig[i]];
        openCategoryModal();
    }
}
function updateCatsTmp() {
    document.querySelectorAll('.cat-lbl').forEach((el,i) => categoriesConfig[i].label = el.value);
}
function saveCategorySettings() {
    updateCatsTmp();
    db.collection(COL_SETTINGS).doc('categories').set({list:categoriesConfig}).then(()=>{closeCategoryModal(); showToast("Cats Salvas");});
}
function toggleStoreStatus() { db.collection(COL_SETTINGS).doc('store').set({isOpen:document.getElementById('store-toggle').checked},{merge:true}); }
function toggleManualOverride() { db.collection(COL_SETTINGS).doc('store').set({manualOverride:document.getElementById('manual-override').checked},{merge:true}); }
function showToast(m) { const t=document.getElementById('toast'); t.innerText=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2000); }
