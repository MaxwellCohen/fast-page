setTimeout(() => {
  const now = new Date().getTime() + 1000;
  let x = 0;
  console.log("task start", x);
  while (now > new Date().getTime()) {
    x = x + 1;
  }

  console.log("task end", x);
}, 0);
