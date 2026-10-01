export const themes={
 light:{'bg':'#f4f5f7','panel':'#ffffff','text':'#242832','muted':'#626b79','border':'#dce0e6','accent':'#345dcc','hover':'#edf1f8','input':'#ffffff'},
 dark:{'bg':'#171a20','panel':'#22262e','text':'#eef1f5','muted':'#a2aab7','border':'#454c58','accent':'#9bb4ff','hover':'#303745','input':'#22262e'}
};
export function applyTheme(target:HTMLElement,value:unknown){const theme=value==='dark'?'dark':'light';target.dataset.theme=theme;target.style.colorScheme=theme;for(const [key,color] of Object.entries(themes[theme]))target.style.setProperty('--pce-'+key,color);}
