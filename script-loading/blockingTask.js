const now = new Date().getTime() + 1000;
let x  = 0;
while (now > new Date().getTime()) {
   x = x + 1;
}

console.log(x);
