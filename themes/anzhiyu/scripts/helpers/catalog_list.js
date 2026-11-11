hexo.extend.helper.register("catalog_list", function (type) {
  let html = ``;
  hexo.locals.get(type).map(function (item) {
    const url = require('hexo-util').url_for.call(hexo, item.path);
    html += `
    <div class="catalog-list-item" id="${url}">
      <a href="${url}">
        ${item.name}
      </a>
    </div>
    `;
  });
  return html;
});
