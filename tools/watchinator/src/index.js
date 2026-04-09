export default {
  fetch() {
    return new Response("Watch-inator worker — config API TBD", {
      status: 501,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
