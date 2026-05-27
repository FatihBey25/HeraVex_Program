import fs from 'fs';

const p = 'c:/tauri_hubUltra/src/App.tsx';
let data = fs.readFileSync(p, 'utf8');

data = data.replace(
  /totalSpent:\s*"Total depense",/,
  `totalSpent: "Total depense",
    wTopLayer: "COUCHE SUPÉRIEURE",
    wStudioDash: "Tableau de Bord du Studio",
    wStudioDashDesc: "État global du studio et de tous les projets.",
    wTotalAll: "TOUS LES PROJETS + DÉPENSES GÉNÉRALES TOTALES",
    wExportCSV: "Exporter (CSV)",
    wExchangeRates: "Taux de Change (Base USD)",
    wRatesDesc: "Les chiffres se mettent à jour instantanément.",
    wMiddleLayer: "COUCHE INTERMÉDIAIRE",
    wMiddleLayerTitle: "Dépenses Générales du Studio",
    wMiddleLayerDesc: "Coûts non liés au projet comme le loyer, le matériel ou les licences.",
    wBottomLayer: "COUCHE INFÉRIEURE - DÉPENSES PAR PROJET",
    wAddGeneral: "Ajouter une Dépense Générale",
    wAddProject: "Ajouter une Dépense de Projet",
    wExpenseTitle: "Titre de la Dépense",
    wAmount: "Montant",
    wCurrency: "Devise",
    wCategory: "Catégorie",
    wDate: "Date",
    wRecurring: "Mensuel Récurrent (Abonnement)",
    wAdd: "Ajouter",
    wExpenseDist: "Répartition des Dépenses",
    wHistory: "Historique des Dépenses",
    wBudgetSpent: "Budget Dépensé",
    wNoBudget: "Aucune limite de budget définie.",`
);

data = data.replace(
  /totalSpent:\s*"Total gastado",/,
  `totalSpent: "Total gastado",
    wTopLayer: "CAPA SUPERIOR",
    wStudioDash: "Panel del Estudio",
    wStudioDashDesc: "Estado global del estudio y todos los proyectos.",
    wTotalAll: "TODOS LOS PROYECTOS + GASTOS GENERALES",
    wExportCSV: "Exportar (CSV)",
    wExchangeRates: "Tipos de Cambio (Base USD)",
    wRatesDesc: "Los números se actualizan de inmediato.",
    wMiddleLayer: "CAPA MEDIA",
    wMiddleLayerTitle: "Gastos Generales del Estudio",
    wMiddleLayerDesc: "Gastos no relacionados con el proyecto como oficina, equipo o licencias.",
    wBottomLayer: "CAPA INFERIOR - GASTOS POR PROYECTO",
    wAddGeneral: "Agregar Gasto General",
    wAddProject: "Agregar Gasto al Proyecto",
    wExpenseTitle: "Título del Gasto",
    wAmount: "Monto",
    wCurrency: "Moneda",
    wCategory: "Categoría",
    wDate: "Fecha",
    wRecurring: "Recurrente Mensual (Suscripción)",
    wAdd: "Agregar",
    wExpenseDist: "Distribución de Gastos",
    wHistory: "Historial de Gastos",
    wBudgetSpent: "Presupuesto Gastado",
    wNoBudget: "Sin límite de presupuesto.",`
);

fs.writeFileSync(p, data, 'utf8');
console.log("App.tsx French and Spanish Inject Complete!");
