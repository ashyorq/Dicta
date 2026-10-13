// Keep unchanged study controls in place instead of replacing the whole screen.
function patchNode(current, next) {
  if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
    current.replaceWith(next.cloneNode(true));
    return;
  }
  if (current.nodeType !== Node.ELEMENT_NODE) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  for (const attribute of [...current.attributes]) {
    // A learner's open memory note stays open when moving to another term.
    if (current.tagName === 'DETAILS' && attribute.name === 'open') continue;
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of next.attributes) {
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
  const oldChildren = [...current.childNodes], newChildren = [...next.childNodes];
  for (let index = 0; index < Math.max(oldChildren.length, newChildren.length); index++) {
    if (!newChildren[index]) oldChildren[index].remove();
    else if (!oldChildren[index]) current.append(newChildren[index].cloneNode(true));
    else patchNode(oldChildren[index], newChildren[index]);
  }
}

let releaseFrame = 0;
let releaseOnScroll = null;

export function updateView(container, html, preserve = false) {
  cancelAnimationFrame(releaseFrame);
  if (releaseOnScroll) window.removeEventListener('scroll', releaseOnScroll);
  releaseOnScroll = null;
  // A shorter next term must not clamp the scroll position before navigation.
  container.style.minHeight = `${container.getBoundingClientRect().height}px`;
  const template = document.createElement('template');
  template.innerHTML = html;
  if (preserve && container.children.length === 1 && template.content.children.length === 1) {
    patchNode(container.firstElementChild, template.content.firstElementChild);
  } else {
    container.replaceChildren(template.content);
  }

  function releaseHeight() {
    releaseFrame = 0;
    const style = getComputedStyle(container);
    const naturalHeight = container.firstElementChild.getBoundingClientRect().height
      + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const extraHeight = Math.max(0, container.getBoundingClientRect().height - naturalHeight);
    const naturalScrollEnd = Math.max(0, document.documentElement.scrollHeight - extraHeight - innerHeight);
    if (scrollY <= naturalScrollEnd + 1) {
      container.style.minHeight = '';
      window.removeEventListener('scroll', releaseHeight);
      releaseOnScroll = null;
    } else {
      releaseOnScroll = releaseHeight;
      window.addEventListener('scroll', releaseHeight, { passive: true });
    }
  }
  releaseFrame = requestAnimationFrame(releaseHeight);
}

export function scrollToStart() {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, left: 0, behavior: reducedMotion ? 'instant' : 'smooth' });
}
