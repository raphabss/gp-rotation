#!/usr/bin/env python3
# fix-tv-frontend.py — corrige o frontend-tv/index.html no LUGAR, sem tocar
# em mais nada (todos os logos base64 existentes sao preservados).
#
# Faz DUAS coisas, ambas idempotentes:
#   1) Troca o bloco de cores inline: mesas sem cor fixa deixam de cair no
#      cinza; passam a receber cor DETERMINISTICA da paleta da propria marca
#      (CDA usa as cores da 1a tabela; Sports Club ganha paleta propria;
#      marca desconhecida usa paleta generica viva). Cinza so para 'B'.
#   2) Adiciona o logo do "Sports Club" ao BRAND_LOGOS (aparece na barra da
#      marca assim que o backend passar a emitir o bloco "Sports Club").
#
# Uso (dentro de /opt/gp-rotation/frontend-tv):
#   python3 fix-tv-frontend.py
#   python3 fix-tv-frontend.py /caminho/index.html
import sys, os, shutil, datetime

NEW_BLOCK = r'''// Mapa de cores por (marca + mesa) para a TV de Rotacao.
// - Cor FIXA por mesa quando conhecida (fiel aos prints da planilha).
// - Mesa SEM cor fixa: cor DETERMINISTICA da paleta da propria marca
//   (ex.: qualquer mesa CDA usa as cores da 1a tabela CDA). Nunca cai no cinza.
// - Marca DESCONHECIDA (sem titulo CDA/BLAZE/...): paleta generica viva no dark.
// - Cinza fica reservado apenas para 'B' (break).

  var TABLE_COLORS = {
    CDA: {
      '6130':'#f5e7a3', '6131':'#f4c7c7', '6132':'#a9d8a0', '6133':'#e8706c',
      '6134':'#f2f2f2', '6150':'#d8b24e', 'B':'#6f6f6f'
    },
    BLAZE: {
      '6140':'#3b4047', '6141':'#7d1f1f', '6142':'#9a9a9a', '6143':'#ff2d2d',
      '6144':'#efefef', '6150':'#d8b24e', 'B':'#b53636'
    },
    Shufflers: {
      'ALL':'#e8b8e0', 'B':'#e3998a'
    }
  };
  // Paletas de preenchimento (mesas sem cor fixa) — claras/saturadas p/ o dark.
  var BRAND_PALETTES = {
    CDA:            ['#f5e7a3','#f4c7c7','#a9d8a0','#e8706c','#f2f2f2','#d8b24e'],
    BLAZE:          ['#ff2d2d','#efefef','#f2a0a0','#e0743a','#e8b923','#ff8f5c'],
    'Sports Club':  ['#e8d6a0','#a9c58f','#e2e2df','#cbb27a','#f0a35a','#bcd0a0'],
    Shufflers:      ['#e8b8e0','#c9a3f0','#f0b8d0','#b8c8f0']
  };
  var GENERIC_PALETTE = ['#f5e7a3','#a9d8a0','#8ec5ff','#f4a3d2','#ffb27a','#c3a3f5','#8fe0c8','#e8706c','#d8b24e','#9ad0f5','#b6e07a','#ef9ad6'];
  var DEFAULT = { B:'#33414f', ALL:'#e8b8e0', X:'#1a212c' };

  // Luminancia relativa -> decide texto claro/escuro
  function textColor(hex){
    var c = hex.replace('#',''); if(c.length===3){c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];}
    var r=parseInt(c.substr(0,2),16)/255, g=parseInt(c.substr(2,2),16)/255, b=parseInt(c.substr(4,2),16)/255;
    var f=function(v){return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
    var L=0.2126*f(r)+0.7152*f(g)+0.0722*f(b);
    return L>0.45 ? '#15181d' : '#f5f7fa';   // fundo claro->texto escuro; escuro->claro
  }
  // Indice estavel a partir do identificador da mesa (mesma mesa -> mesma cor)
  function paletteIndex(key, len){
    var s=String(key==null?'':key); var digits=s.replace(/\D/g,''); var n;
    if(digits){ n=parseInt(digits,10); } else { n=0; for(var i=0;i<s.length;i++){ n=(n*31+s.charCodeAt(i))>>>0; } }
    return n % len;
  }
  // Cor de fundo de uma mesa, com fallback deterministico e SEMPRE visivel
  function tableColor(brand, table){
    var map=TABLE_COLORS[brand]||{};
    if(map[table]) return map[table];
    var pal=BRAND_PALETTES[brand]||GENERIC_PALETTE;
    return pal[ paletteIndex(table, pal.length) ];
  }
  // Retorna {bg, fg} para uma celula de uma marca
  function cellColor(brand, cell){
    if(!cell) return null;
    var map=TABLE_COLORS[brand]||{};
    var bg=null;
    if(cell.type==='table')        bg=tableColor(brand, cell.table);
    else if(cell.type==='tables')  bg=tableColor(brand, (cell.tables&&cell.tables[0]));
    else if(cell.type==='break')   bg=map['B']||DEFAULT.B;
    else if(cell.type==='all')     bg=map['ALL']||DEFAULT.ALL;
    else if(cell.type==='todo')    return { bg:'transparent', fg:'#e6a23c' };
    else if(cell.type==='off')     return { bg:'transparent', fg:'#3a4658' };
    else return null;
    return { bg: bg, fg: textColor(bg) };
  }
  window.GP_COLORS = { cellColor: cellColor, textColor: textColor, tableColor: tableColor, TABLE_COLORS: TABLE_COLORS, BRAND_PALETTES: BRAND_PALETTES, GENERIC_PALETTE: GENERIC_PALETTE };'''

SPORTSCLUB_LOGO = "data:image/png;base64,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"

CM_START = "// Mapa de cores por (marca + mesa)"
CM_END   = "window.GP_COLORS = {"

def patch_colormap(src):
    i = src.find(CM_START)
    if i < 0:
        raise SystemExit("ERRO: nao achei o inicio do bloco de cores ('%s'). Nada alterado." % CM_START)
    j = src.find(CM_END, i)
    if j < 0:
        raise SystemExit("ERRO: nao achei 'window.GP_COLORS = {' apos o bloco. Nada alterado.")
    k = src.find(";", j)
    if k < 0:
        raise SystemExit("ERRO: bloco window.GP_COLORS sem ';' final. Nada alterado.")
    k += 1
    if "BRAND_PALETTES" in src[i:k]:
        print("  - cores: ja atualizado (BRAND_PALETTES presente). Sem mudanca.")
        return src, False
    out = src[:i] + NEW_BLOCK + src[k:]
    if "#2a3340" in out[i:i+len(NEW_BLOCK)]:
        raise SystemExit("ERRO interno: cinza padrao ainda no bloco novo. Abortado.")
    print("  - cores: bloco atualizado (mesas sem cor fixa usam a paleta da marca).")
    return out, True

def patch_logo(src):
    anchor = "var BRAND_LOGOS = {"
    i = src.find(anchor)
    if i < 0:
        print("  - logo: 'var BRAND_LOGOS = {' nao encontrado. Logo NAO adicionado.")
        return src, False
    # Assinatura especifica do LOGO (evita confundir com a paleta de cores,
    # que tambem contem a chave 'Sports Club').
    if "'Sports Club': ['data:image" in src:
        print("  - logo: 'Sports Club' ja presente em BRAND_LOGOS. Sem mudanca.")
        return src, False
    ins = anchor + "\n  'Sports Club': ['" + SPORTSCLUB_LOGO + "'],"
    out = src[:i] + ins + src[i+len(anchor):]
    print("  - logo: 'Sports Club' adicionado ao BRAND_LOGOS.")
    return out, True

def patch_warnings(src):
    changed = False

    # A) CSS da faixa de aviso — inserida apos a regra .offline.show
    css_anchor = ".offline.show{display:block}"
    warn_css = (
        "\n.warn-banner{display:flex;align-items:flex-start;gap:14px;margin:0 0 14px;padding:14px 20px;"
        "border-radius:10px;background:rgba(230,162,60,.16);border:1px solid rgba(230,162,60,.65)}"
        "\n.warn-banner .warn-ico{font-size:30px;line-height:1;color:#f2c14e;flex:none}"
        "\n.warn-banner .warn-title{font-family:var(--disp);font-size:16px;font-weight:700;letter-spacing:.08em;"
        "text-transform:uppercase;color:#f2c14e;margin-bottom:4px}"
        "\n.warn-banner .warn-item{font-size:16px;font-weight:600;color:#ffe6b3;line-height:1.35}"
    )
    if ".warn-banner{" in src:
        print("  - avisos(css): ja presente. Sem mudanca.")
    elif css_anchor in src:
        src = src.replace(css_anchor, css_anchor + warn_css, 1)
        print("  - avisos(css): faixa .warn-banner adicionada."); changed = True
    else:
        print("  - avisos(css): ancora .offline.show nao encontrada. CSS NAO adicionado.")

    # B) Funcao JS que monta a faixa a partir de state.warnings
    js_anchor = "function render(){"
    warn_js = (
        "function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}\n"
        "function warnBannerHtml(){\n"
        "  var w=(state&&state.warnings)?state.warnings:[];\n"
        "  if(!w||!w.length) return '';\n"
        "  var items=w.map(function(m){return '<div class=\"warn-item\">'+esc(m)+'</div>';}).join('');\n"
        "  return '<div class=\"warn-banner\"><span class=\"warn-ico\">&#9888;</span>"
        "<div class=\"warn-msgs\"><div class=\"warn-title\">Aten&ccedil;&atilde;o &mdash; planilha</div>'+items+'</div></div>';\n"
        "}\n"
    )
    if "function warnBannerHtml(" in src:
        print("  - avisos(js): funcao ja presente. Sem mudanca.")
    elif js_anchor in src:
        src = src.replace(js_anchor, warn_js + js_anchor, 1)
        print("  - avisos(js): warnBannerHtml() adicionada."); changed = True
    else:
        print("  - avisos(js): ancora 'function render(){' nao encontrada. JS NAO adicionado.")

    # C) prepend da faixa no innerHTML normal (matriz / agora-proximo)
    normal_anchor = "fitEl.innerHTML=view==='matrix'?renderMatrix():renderNowNext();"
    normal_new = "fitEl.innerHTML=warnBannerHtml()+(view==='matrix'?renderMatrix():renderNowNext());"
    if normal_new in src:
        print("  - avisos(render): ja aplicado. Sem mudanca.")
    elif normal_anchor in src:
        src = src.replace(normal_anchor, normal_new, 1)
        print("  - avisos(render): faixa incluida no render normal."); changed = True
    else:
        print("  - avisos(render): ancora do innerHTML nao encontrada.")

    # D) prepend da faixa tambem no estado vazio ("Aguardando rotacao")
    empty_anchor = "fitEl.innerHTML='<div class=\"empty-state\">"
    empty_new = "fitEl.innerHTML=warnBannerHtml()+'<div class=\"empty-state\">"
    if empty_new in src:
        print("  - avisos(vazio): ja aplicado. Sem mudanca.")
    elif empty_anchor in src:
        src = src.replace(empty_anchor, empty_new, 1)
        print("  - avisos(vazio): faixa incluida no estado vazio."); changed = True
    else:
        print("  - avisos(vazio): ancora do empty-state nao encontrada.")

    return src, changed

def patch_autoreload(src):
    AR_MARK = "/* gp-auto-reload */"
    if AR_MARK in src:
        print("  - auto-reload: ja presente. Sem mudanca.")
        return src, False
    anchor = "setInterval(function(){fetch(rotaUrl()).then(function(r){return r.json();}).then(function(s){state=s;cache(s);render();}).catch(function(){});},20000);"
    if anchor not in src:
        print("  - auto-reload: ancora do polling nao encontrada. NAO aplicado.")
        return src, False
    ar = (
        "\n" + AR_MARK + "\n"
        "// Recarrega a TV automaticamente quando o index.html muda no servidor\n"
        "// (deploy do frontend). Faz um HEAD em si mesma e compara ETag/Last-Modified.\n"
        "(function(){\n"
        "  var seen=null, RELOADING=false;\n"
        "  function tag(r){ return r.headers.get('ETag')||r.headers.get('Last-Modified')||null; }\n"
        "  function check(){\n"
        "    if(RELOADING) return Promise.resolve();\n"
        "    return fetch(location.pathname,{method:'HEAD',cache:'no-store'})\n"
        "      .then(function(r){ var v=tag(r); if(!v) return;\n"
        "        if(seen===null){ seen=v; return; }\n"
        "        if(v!==seen){ RELOADING=true; setTimeout(function(){ location.reload(); },500); } })\n"
        "      .catch(function(){});\n"
        "  }\n"
        "  window.__gpAutoReloadCheck=check;   // permite disparar a checagem na mao (debug)\n"
        "  setInterval(check, 30000);\n"
        "  check();\n"
        "})();\n"
    )
    src = src.replace(anchor, anchor + ar, 1)
    print("  - auto-reload: vigilancia de versao adicionada (HEAD a cada 30s).")
    return src, True

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "index.html"
    if not os.path.isfile(path):
        raise SystemExit("ERRO: nao encontrei %s (rode dentro de frontend-tv/ ou passe o caminho)" % path)
    src = open(path, encoding="utf-8").read()
    print("Processando %s" % path)
    src, ch1 = patch_colormap(src)
    src, ch2 = patch_logo(src)
    src, ch3 = patch_warnings(src)
    src, ch4 = patch_autoreload(src)
    if not (ch1 or ch2 or ch3 or ch4):
        print("Nada a fazer — arquivo ja esta atualizado.")
        return
    bak = path + ".bak-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(path, bak)
    open(path, "w", encoding="utf-8").write(src)
    print("OK. backup: %s" % bak)

if __name__ == "__main__":
    main()
